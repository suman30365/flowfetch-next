import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { validateYouTubeUrl } from '../utils/urlValidator';
import { downloadFormat, isValidFormatId, cleanupJob, JobProgress } from '../services/ytdlp';
import { jobQueue } from '../services/jobQueue';
import { mapYtdlpError } from '../utils/errorMapper';
import { safeFilename, toAsciiFilename } from '../utils/filename';
import { DownloadRequest, StreamType, DownloadPrepareResponse, DownloadStatusResponse } from '../types';
import { downloadPrepareLimiter, downloadStatusLimiter, downloadFileLimiter } from '../middleware/rateLimiter';

export const downloadRouter = Router();

const DOWNLOAD_TIMEOUT_MS = parseInt(process.env.DOWNLOAD_TIMEOUT_MS ?? '300000', 10);
const VALID_STREAM_TYPES = new Set<string>(['video+audio', 'video', 'audio']);
const JOB_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export type JobStatus = 'processing' | 'ready' | 'error' | 'cancelled';

export interface DownloadJob {
  jobId: string;
  token: string;
  url: string;
  formatId: string;
  streamType: StreamType;
  title: string;
  expectedFilename: string;
  status: JobStatus;
  createdAt: number;
  expiresAt: number;
  filePath?: string;
  filename?: string;
  ext?: string;
  size?: number;
  error?: { error: string; message: string; statusCode?: number };
  progress?: JobProgress;
  emitter: EventEmitter;
  abortController: AbortController;
  activeGetRequests: number;
}

// In-memory store of active and completed download jobs
export const jobs = new Map<string, DownloadJob>();

// Alias for test backward compatibility
export const readyJobs = jobs;

/**
 * Timing-safe string comparison to protect download tokens against timing attacks
 */
function timingSafeTokenMatch(expected: string, provided: string): boolean {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  const bufA = Buffer.from(expected);
  const bufB = Buffer.from(provided);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function cleanupJobFiles(job: DownloadJob): void {
  try {
    if (job.filePath && fs.existsSync(job.filePath)) {
      fs.rmSync(job.filePath, { force: true });
    }
    if (job.filePath) {
      const dir = path.dirname(job.filePath);
      const prefix = path.basename(job.filePath).split('.')[0];
      cleanupJob(dir, prefix);
    }
  } catch {
    // Best-effort cleanup
  }
}

function removeJob(job: DownloadJob): void {
  jobs.delete(job.jobId);
  cleanupJobFiles(job);
}

// Background cleaner for expired, abandoned jobs
setInterval(() => {
  const now = Date.now();
  for (const [, job] of jobs.entries()) {
    if (job.expiresAt <= now) {
      console.log(`[FlowFetch] Cleaning up expired download job: ${job.jobId}`);
      removeJob(job);
    }
  }
}, 60_000).unref();

// ── Step 1: POST /api/download (Reserve Job & Start Background Preparation) ──
downloadRouter.post('/', downloadPrepareLimiter, async (req: Request, res: Response) => {
  const { url, formatId, title } = req.body as Partial<DownloadRequest> & { streamType?: string };
  const rawStreamType: string | undefined = (req.body as { streamType?: string }).streamType;

  // 1. Validate URL
  let normalizedUrl: string;
  try {
    normalizedUrl = validateYouTubeUrl(url ?? '');
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return res.status(400).json({
      error: err.code ?? 'invalid_url',
      message: err.message ?? 'Invalid URL',
    });
  }

  // 2. Validate format ID
  if (!formatId || !isValidFormatId(formatId)) {
    return res.status(400).json({
      error: 'unsupported_format',
      message: 'Invalid or missing format ID.',
    });
  }

  // 3. Validate streamType
  if (!rawStreamType || !VALID_STREAM_TYPES.has(rawStreamType)) {
    return res.status(400).json({
      error: 'unsupported_format',
      message: 'Invalid or missing streamType.',
    });
  }
  const streamType = rawStreamType as StreamType;

  // 4. Double-click deduplication: check if identical request is currently processing or recently ready
  const now = Date.now();
  for (const [, existingJob] of jobs.entries()) {
    if (
      existingJob.url === normalizedUrl &&
      existingJob.formatId === formatId &&
      existingJob.streamType === streamType &&
      (existingJob.status === 'processing' || (existingJob.status === 'ready' && now - existingJob.createdAt < 30_000))
    ) {
      console.log(`[FlowFetch] Deduplicated repeated download request: reusing job ${existingJob.jobId}`);
      const payload: DownloadPrepareResponse = {
        status: existingJob.status === 'ready' ? 'ready' : 'processing',
        jobId: existingJob.jobId,
        token: existingJob.token,
        downloadUrl: `/api/download/file/${existingJob.jobId}?token=${existingJob.token}`,
        filename: existingJob.filename ?? existingJob.expectedFilename,
        size: existingJob.size,
      };
      return res.status(200).json(payload);
    }
  }

  // 5. Check concurrency limit
  if (jobQueue.isFull) {
    return res.status(429).json({
      error: 'concurrent_limit_exceeded',
      message: 'Server is busy — please try again in a moment.',
    });
  }

  const safeTitle = typeof title === 'string' && title.trim() ? title.trim() : 'download';
  const defaultExt = streamType === 'audio' ? 'm4a' : 'mp4';
  const expectedFilename = safeFilename(safeTitle, defaultExt);

  const jobId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');

  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  emitter.on('error', () => {}); // Prevent unhandled error event exception
  const abortController = new AbortController();

  const job: DownloadJob = {
    jobId,
    token,
    url: normalizedUrl,
    formatId,
    streamType,
    title: safeTitle,
    expectedFilename,
    status: 'processing',
    createdAt: now,
    expiresAt: now + JOB_EXPIRY_MS,
    emitter,
    abortController,
    activeGetRequests: 0,
  };

  jobs.set(jobId, job);
  jobQueue.acquire();

  // Kick off background download & merge
  (async () => {
    try {
      console.log(`[FlowFetch background job start] id=${jobId} format=${formatId} streamType=${streamType} url=${normalizedUrl}`);
      const result = await downloadFormat(
        normalizedUrl,
        formatId,
        streamType,
        DOWNLOAD_TIMEOUT_MS,
        abortController.signal,
        (progress) => {
          job.progress = progress;
        },
      );

      // Verify file integrity
      const stat = fs.statSync(result.filePath);
      if (stat.size === 0) {
        cleanupJob(path.dirname(result.filePath), path.basename(result.filePath).split('.')[0]);
        throw Object.assign(new Error('Output file is empty'), { code: 'internal_error' });
      }

      const finalFilename = safeFilename(safeTitle, result.ext);
      job.status = 'ready';
      job.filePath = result.filePath;
      job.filename = finalFilename;
      job.ext = result.ext;
      job.size = stat.size;
      job.progress = { stage: 'ready', percent: 100, detail: 'Media preparation complete! Streaming file...' };
      job.expiresAt = Date.now() + JOB_EXPIRY_MS;

      console.log(`[FlowFetch background job ready] id=${jobId} file=${finalFilename} size=${stat.size}`);
      job.emitter.emit('ready', job);
    } catch (e) {
      if (job.status === 'cancelled') return;
      const { code, message } = mapYtdlpError(e);
      const statusCode =
        code === 'timeout'                                              ? 504
        : code === 'unsupported_format'                                ? 400
        : code === 'unavailable_video' || code === 'upstream_rejected' ? 422
        : 500;

      job.status = 'error';
      job.error = { error: code, message, statusCode };
      console.error(`[FlowFetch background job error] id=${jobId} error=${code}: ${message}`);
      job.emitter.emit('error', job.error);
    } finally {
      jobQueue.release();
    }
  })();

  // Return immediately with the reserved job credentials and stable download URL
  const prepareResponse: DownloadPrepareResponse = {
    status: 'processing',
    jobId,
    token,
    downloadUrl: `/api/download/file/${jobId}?token=${token}`,
    filename: expectedFilename,
  };

  return res.status(200).json(prepareResponse);
});

// ── Step 2: GET /api/download/file/:jobId (Browser-Native File Stream) ─────────
downloadRouter.get('/file/:jobId', downloadFileLimiter, (req: Request, res: Response) => {
  const { jobId } = req.params;
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Download link has expired or is invalid. Please start a new download.',
    });
  }

  // Validate token
  if (!token || !timingSafeTokenMatch(job.token, token)) {
    return res.status(403).json({
      error: 'unauthorized',
      message: 'Access denied: invalid download token.',
    });
  }

  // Check expiration
  if (job.expiresAt <= Date.now()) {
    removeJob(job);
    return res.status(410).json({
      error: 'link_expired',
      message: 'Download link has expired. Please try again.',
    });
  }

  // Check if job encountered an error during preparation
  if (job.status === 'error') {
    return res.status(job.error?.statusCode ?? 500).json({
      error: job.error?.error ?? 'internal_error',
      message: job.error?.message ?? 'Download failed.',
    });
  }

  if (job.status === 'cancelled') {
    return res.status(499).json({
      error: 'cancelled',
      message: 'Download was cancelled.',
    });
  }

  // If file is already prepared and ready, stream immediately
  if (job.status === 'ready' || (!job.status && job.filePath)) {
    return streamJobFile(job, req, res);
  }

  // If job is still processing, keep GET request pending until completion
  if (job.status === 'processing') {
    // Extend socket timeout so large files requiring lengthy downloading/merging don't drop
    req.socket.setTimeout(DOWNLOAD_TIMEOUT_MS + 60_000);

    job.activeGetRequests++;
    console.log(`[FlowFetch] Holding pending download GET connection for job ${jobId}`);

    let isHandled = false;

    const onReady = (readyJob: DownloadJob) => {
      if (isHandled) return;
      isHandled = true;
      cleanupListeners();
      streamJobFile(readyJob, req, res);
    };

    const onError = (err: { error: string; message: string; statusCode?: number }) => {
      if (isHandled) return;
      isHandled = true;
      cleanupListeners();
      if (!res.headersSent) {
        res.status(err.statusCode ?? 500).json({ error: err.error, message: err.message });
      }
    };

    const onClose = () => {
      if (isHandled || res.writableEnded) return;
      cleanupListeners();
      job.activeGetRequests = Math.max(0, job.activeGetRequests - 1);
      console.log(`[FlowFetch] Client closed pending download connection for job ${jobId}`);
    };

    const cleanupListeners = () => {
      if (job.emitter) {
        job.emitter.off('ready', onReady);
        job.emitter.off('error', onError);
      }
      res.off('close', onClose);
    };

    if (job.emitter) {
      job.emitter.once('ready', onReady);
      job.emitter.once('error', onError);
    }
    res.once('close', onClose);

    return;
  }
});

// Helper function to stream completed file
function streamJobFile(job: DownloadJob, req: Request, res: Response): void {
  if (!job.filePath || !fs.existsSync(job.filePath)) {
    removeJob(job);
    if (!res.headersSent) {
      res.status(404).json({
        error: 'not_found',
        message: 'File not found on server.',
      });
    }
    return;
  }

  const finalName = job.filename ?? job.expectedFilename ?? 'download.mp4';
  const finalExt = job.ext ?? (path.extname(finalName).slice(1) || 'mp4');
  const asciiFallback = toAsciiFilename(finalName);
  const encodedFilename = encodeURIComponent(finalName);

  res.setHeader('Content-Type', mimeForExt(finalExt));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`,
  );
  if (job.size) {
    res.setHeader('Content-Length', job.size.toString());
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const fileStream = fs.createReadStream(job.filePath);

  fileStream.on('error', (err) => {
    console.error(`[download stream error] job=${job.jobId}:`, err.message);
    removeJob(job);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: 'Stream error.' });
    } else {
      res.destroy();
    }
  });

  // Client aborted / closed tab mid-stream
  res.on('close', () => {
    if (!res.writableEnded) {
      console.log(`[FlowFetch] Client aborted download mid-stream for job ${job.jobId}`);
      fileStream.destroy();
      removeJob(job);
    }
  });

  // Successful streaming completion
  res.on('finish', () => {
    console.log(`[download stream complete] job=${job.jobId} file=${finalName} size=${job.size}`);
    removeJob(job);
  });

  fileStream.pipe(res);
}

// ── Step 3: GET /api/download/status/:jobId (Real-time Status Polling) ───────
downloadRouter.get('/status/:jobId', downloadStatusLimiter, (req: Request, res: Response) => {
  const { jobId } = req.params;
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Download job not found or expired.',
    });
  }

  if (!token || !timingSafeTokenMatch(job.token, token)) {
    return res.status(403).json({
      error: 'unauthorized',
      message: 'Access denied: invalid download token.',
    });
  }

  const response: DownloadStatusResponse = {
    status: job.status === 'processing' ? 'processing' : job.status === 'ready' ? 'ready' : 'error',
    jobId: job.jobId,
    filename: job.filename ?? job.expectedFilename,
    size: job.size,
    downloadUrl: `/api/download/file/${job.jobId}?token=${job.token}`,
    progress: job.progress,
    error: job.error ? { error: job.error.error, message: job.error.message } : undefined,
  };

  return res.json(response);
});

// ── Step 4: POST /api/download/cancel/:jobId (User Cancellation) ─────────────
downloadRouter.post('/cancel/:jobId', downloadFileLimiter, (req: Request, res: Response) => {
  const { jobId } = req.params;
  const token = typeof req.query.token === 'string' ? req.query.token : (req.body?.token ?? '');

  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Download job not found.',
    });
  }

  if (!token || !timingSafeTokenMatch(job.token, token)) {
    return res.status(403).json({
      error: 'unauthorized',
      message: 'Access denied: invalid download token.',
    });
  }

  if (job.status === 'processing') {
    job.status = 'cancelled';
    job.abortController.abort();
    if (job.emitter && job.emitter.listenerCount('error') === 0) {
      job.emitter.on('error', () => {});
    }
    job.emitter.emit('error', {
      error: 'cancelled',
      message: 'Download was cancelled by user.',
      statusCode: 499,
    });
    removeJob(job);
    return res.json({ ok: true, status: 'cancelled' });
  }

  removeJob(job);
  return res.json({ ok: true, status: 'cancelled' });
});

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    mp4:  'video/mp4',
    webm: 'video/webm',
    mkv:  'video/x-matroska',
    m4a:  'audio/mp4',
    mp3:  'audio/mpeg',
    ogg:  'audio/ogg',
    opus: 'audio/ogg',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}
