import { Router, Request, Response, NextFunction } from 'express';
import { validateYouTubeUrl } from '../utils/urlValidator';
import { analyzeVideo } from '../services/ytdlp';
import { jobQueue } from '../services/jobQueue';
import { mapYtdlpError } from '../utils/errorMapper';
import { AnalyzeRequest } from '../types';

export const analyzeRouter = Router();

const ANALYZE_TIMEOUT_MS = parseInt(process.env.ANALYZE_TIMEOUT_MS ?? '30000', 10);

analyzeRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const { url } = req.body as Partial<AnalyzeRequest>;

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

  // 2. Check concurrency (analyze counts toward the pool)
  if (jobQueue.isFull) {
    return res.status(429).json({
      error: 'concurrent_limit_exceeded',
      message: 'Server is busy — please try again in a moment.',
    });
  }

  jobQueue.acquire();
  try {
    const meta = await analyzeVideo(normalizedUrl, ANALYZE_TIMEOUT_MS);
    return res.json(meta);
  } catch (e) {
    const { code, message } = mapYtdlpError(e);
    const status =
      code === 'timeout' ? 504
      : code === 'unavailable_video' || code === 'upstream_rejected' ? 422
      : 500;
    // Don't call next(e) — we already mapped it to a safe response
    return res.status(status).json({ error: code, message });
  } finally {
    jobQueue.release();
  }
});
