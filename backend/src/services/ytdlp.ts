import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { FormatInfo, StreamType } from '../types';

const YTDLP = process.env.YTDLP_PATH ?? 'yt-dlp';

/**
 * yt-dlp's --ffmpeg-location expects a DIRECTORY containing ffmpeg/ffprobe,
 * not a bare binary name.  When given just "ffmpeg", yt-dlp silently skips
 * the merge step — the root cause of the download failure.
 *
 * This function resolves the configured (or default) ffmpeg path to the
 * directory containing the binary so --ffmpeg-location works correctly.
 */
function resolveFFmpegDir(): string {
  const configured = process.env.FFMPEG_PATH ?? 'ffmpeg';

  // If the user already provided a directory path, use it directly
  if (fs.existsSync(configured) && fs.statSync(configured).isDirectory()) {
    return configured;
  }

  // If it's an absolute path to the binary, return its parent directory
  if (path.isAbsolute(configured) && fs.existsSync(configured)) {
    return path.dirname(configured);
  }

  // Resolve bare binary name via PATH using `where` (Windows) or `which` (Unix)
  try {
    const cmd = os.platform() === 'win32' ? `where ${configured}` : `which ${configured}`;
    const resolved = execSync(cmd, { encoding: 'utf-8', timeout: 5000 })
      .split('\n')[0]
      .trim();
    if (resolved && fs.existsSync(resolved)) {
      const dir = path.dirname(resolved);
      console.log(`[FlowFetch] Resolved ffmpeg location: ${dir}`);
      return dir;
    }
  } catch {
    // Resolution failed — fall through
  }

  // Windows fallback: if terminal PATH was stale (e.g. backend started before winget install),
  // probe common WinGet package directories directly.
  if (os.platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const wingetDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
      if (fs.existsSync(wingetDir)) {
        try {
          const packages = fs.readdirSync(wingetDir).filter((p) => p.toLowerCase().includes('ffmpeg'));
          for (const pkg of packages) {
            const pkgPath = path.join(wingetDir, pkg);
            // Check direct bin or subfolder bin (e.g. Gyan.FFmpeg_.../ffmpeg-9.0.2-.../bin)
            const directBin = path.join(pkgPath, 'bin');
            if (fs.existsSync(path.join(directBin, 'ffmpeg.exe'))) {
              console.log(`[FlowFetch] Resolved ffmpeg from WinGet packages: ${directBin}`);
              return directBin;
            }
            const subdirs = fs.readdirSync(pkgPath);
            for (const sub of subdirs) {
              const subBin = path.join(pkgPath, sub, 'bin');
              if (fs.existsSync(path.join(subBin, 'ffmpeg.exe'))) {
                console.log(`[FlowFetch] Resolved ffmpeg from WinGet packages: ${subBin}`);
                return subBin;
              }
            }
          }
        } catch {
          // Ignore directory traversal errors
        }
      }
    }
  }

  console.warn(
    `[FlowFetch] WARNING: Could not resolve ffmpeg directory from "${configured}". ` +
    `Merging video+audio streams will fail. Set FFMPEG_PATH to the directory containing ffmpeg.`,
  );
  return configured; // best-effort fallback
}

const FFMPEG_DIR = resolveFFmpegDir();

// ── Allowed format ID pattern — yt-dlp IDs are alphanumeric + dash/plus ──────
// Also allow the '+' separator used in merge specs like "137+140"
const FORMAT_ID_RE = /^[A-Za-z0-9_\-+.]{1,50}$/;

export function isValidFormatId(id: string): boolean {
  return FORMAT_ID_RE.test(id);
}

// ── Analyze ───────────────────────────────────────────────────────────────────

export interface VideoMeta {
  title: string;
  thumbnail?: string;
  duration?: number;
  formats: FormatInfo[];
}

/**
 * Runs `yt-dlp --dump-json` on the validated URL and returns normalised metadata.
 * Never fabricates data — returns only what yt-dlp actually reports.
 */
export async function analyzeVideo(url: string, timeoutMs: number): Promise<VideoMeta> {
  const raw = await runYtdlpJson(url, timeoutMs);
  return parseYtdlpJson(raw);
}

function runYtdlpJson(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--skip-download',
      url,
    ];

    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(Object.assign(new Error('yt-dlp analyze timed out'), { code: 'timeout' }));
      }
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(stdout);
      } else {
        console.error(`[yt-dlp analyze] exit ${code}: ${stderr.slice(0, 500)}`);
        reject(new Error(stderr));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseYtdlpJson(raw: string): VideoMeta {
  const firstLine = raw.trim().split('\n')[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = JSON.parse(firstLine);
  } catch {
    throw Object.assign(new Error('Failed to parse yt-dlp output'), { code: 'internal_error' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawFormats: any[] = Array.isArray(data.formats) ? data.formats : [];

  const formats: FormatInfo[] = rawFormats
    .filter((f) => f.format_id && f.ext)
    .map((f) => {
      const hasVideo = !!f.vcodec && f.vcodec !== 'none';
      const hasAudio = !!f.acodec && f.acodec !== 'none';

      const streamType: StreamType =
        hasVideo && hasAudio ? 'video+audio'
        : hasVideo           ? 'video'
        :                      'audio';

      const height = f.height ? `${f.height}p` : '';
      const label = buildLabel(f, streamType, height);

      const vcodec = typeof f.vcodec === 'string' && f.vcodec !== 'none' ? f.vcodec : undefined;
      const acodec = typeof f.acodec === 'string' && f.acodec !== 'none' ? f.acodec : undefined;
      const dynamicRange = typeof f.dynamic_range === 'string' ? f.dynamic_range : undefined;
      const isDrc = String(f.format_id).toLowerCase().includes('-drc');

      let codecName: string | undefined;
      if (vcodec) {
        const v = vcodec.toLowerCase();
        if (v.startsWith('avc') || v.startsWith('h264')) codecName = 'H.264';
        else if (v.startsWith('vp09') || v.startsWith('vp9')) codecName = 'VP9';
        else if (v.startsWith('av01') || v.startsWith('av1')) codecName = 'AV1';
        else if (v.startsWith('hev1') || v.startsWith('h265')) codecName = 'HEVC';
        else codecName = vcodec.split('.')[0].toUpperCase();
      } else if (acodec) {
        const a = acodec.toLowerCase();
        if (a.startsWith('mp4a') || a.includes('aac')) codecName = 'AAC';
        else if (a.startsWith('opus')) codecName = 'Opus';
        else if (a.includes('mp3')) codecName = 'MP3';
        else codecName = acodec.split('.')[0].toUpperCase();
      }

      const exactSize = typeof f.filesize === 'number' && f.filesize > 0 ? f.filesize : undefined;
      const approxSize = typeof f.filesize_approx === 'number' && f.filesize_approx > 0 ? f.filesize_approx : undefined;
      const resolvedFilesize = exactSize ?? approxSize;
      const isApproximate = !exactSize && typeof approxSize === 'number';

      return {
        formatId: String(f.format_id),
        label,
        ext: String(f.ext),
        quality: height || (typeof f.quality === 'number' ? String(f.quality) : 'unknown'),
        streamType,
        hasAudio,
        hasVideo,
        filesize: resolvedFilesize,
        filesizeApprox: approxSize,
        isApproximate,
        tbr: typeof f.tbr === 'number' ? Math.round(f.tbr) : (typeof f.abr === 'number' ? Math.round(f.abr) : (typeof f.vbr === 'number' ? Math.round(f.vbr) : undefined)),
        fps: typeof f.fps === 'number' ? f.fps : undefined,
        vcodec,
        acodec,
        codecName,
        dynamicRange,
        isDrc,
      } satisfies FormatInfo;
    })
    // Drop formats that carry neither audio nor video
    // (storyboard tiles, thumbnails, and other metadata streams yt-dlp may include)
    .filter((f) => f.hasVideo || f.hasAudio)
    .sort((a, b) => streamTypePriority(a) - streamTypePriority(b));

  return {
    title: String(data.title ?? 'Untitled'),
    thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : undefined,
    duration: typeof data.duration === 'number' ? data.duration : undefined,
    formats,
  };
}

/** Lower score = higher in the list */
function streamTypePriority(f: FormatInfo): number {
  // Within each tier sort by resolution (desc), then by format_id (asc as tiebreak)
  const tierScore =
    f.streamType === 'video+audio' ? 0
    : f.streamType === 'video'      ? 1
    :                                 2;

  // Extract numeric height from quality string like "1080p" or "720p"
  const heightMatch = f.quality.match(/^(\d+)p$/);
  const height = heightMatch ? parseInt(heightMatch[1], 10) : 0;

  // Combined: combined formats first, then within each tier highest resolution first
  return tierScore * 10000 - height;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLabel(f: any, streamType: StreamType, height: string): string {
  const parts: string[] = [];

  if (height) parts.push(height);
  if (f.ext)  parts.push(f.ext.toUpperCase());

  // Explicit, unambiguous stream-type badge
  switch (streamType) {
    case 'video+audio': parts.push('video + audio'); break;
    case 'video':       parts.push('⚠ video only — will auto-merge audio'); break;
    case 'audio':       parts.push('audio only'); break;
  }

  if (f.tbr) parts.push(`${Math.round(f.tbr)}kbps`);

  return parts.join(' · ') || f.format_note || String(f.format_id);
}

// ── Download ──────────────────────────────────────────────────────────────────

export interface DownloadResult {
  filePath: string;
  filename: string;
  ext: string;
}

export interface JobProgress {
  stage: 'downloading' | 'merging' | 'ready';
  percent?: number;
  speed?: string;
  eta?: string;
  detail?: string;
}

export function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  } else {
    try { child.kill('SIGKILL'); } catch {}
  }
}

/**
 * Downloads the requested format via yt-dlp.
 *
 * Format selection strategy:
 *  - If `formatId` is a combined format (video+audio), pass it directly.
 *  - If `formatId` is a video-only format, pass `<id>+bestaudio[ext=m4a]/bestaudio`
 *    so yt-dlp automatically fetches the best audio and lets FFmpeg merge them.
 *  - If `formatId` is an audio-only format, pass it directly.
 *
 * The caller must supply `streamType` so we know which strategy to use without
 * re-running yt-dlp.
 */
export async function downloadFormat(
  url: string,
  formatId: string,
  streamType: StreamType,
  timeoutMs: number,
  abortSignal?: AbortSignal,
  onProgress?: (progress: JobProgress) => void,
): Promise<DownloadResult> {
  if (!isValidFormatId(formatId)) {
    throw Object.assign(new Error('Invalid format ID'), { code: 'unsupported_format' });
  }

  if (abortSignal?.aborted) {
    throw Object.assign(new Error('Download cancelled'), { code: 'cancelled' });
  }

  const tmpDir = process.env.TMP_DIR
    ? path.resolve(process.env.TMP_DIR)
    : path.join(os.tmpdir(), 'flowfetch');

  fs.mkdirSync(tmpDir, { recursive: true });

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputTemplate = path.join(tmpDir, `${jobId}.%(ext)s`);

  // Build the -f argument for yt-dlp
  const formatSpec = buildFormatSpec(formatId, streamType);

  return new Promise((resolve, reject) => {
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--progress',
      '--newline',
      '-f', formatSpec,
      '--ffmpeg-location', FFMPEG_DIR,
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      url,
    ];

    console.log(`[yt-dlp download] format spec: ${formatSpec}`);
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        killProcessTree(child);
        cleanupJob(tmpDir, jobId);
        reject(Object.assign(new Error('Download timed out'), { code: 'timeout' }));
      }
    }, timeoutMs);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        killProcessTree(child);
        cleanupJob(tmpDir, jobId);
        reject(Object.assign(new Error('Download cancelled'), { code: 'cancelled' }));
      }
    };

    if (abortSignal) {
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      process.stdout.write(text);

      if (onProgress) {
        const lines = text.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.includes('[Merger]')) {
            onProgress({
              stage: 'merging',
              percent: 99,
              detail: 'Merging video & audio streams with FFmpeg...',
            });
          } else if (trimmed.includes('[download]') && trimmed.includes('%')) {
            const pctMatch = trimmed.match(/(\d+(?:\.\d+)?)%/);
            const speedMatch = trimmed.match(/at\s+([^\s]+)/);
            const etaMatch = trimmed.match(/ETA\s+([^\s]+)/);
            const percent = pctMatch ? parseFloat(pctMatch[1]) : undefined;
            const speed = speedMatch ? speedMatch[1] : undefined;
            const eta = etaMatch ? etaMatch[1] : undefined;

            let detail = 'Downloading media streams...';
            if (percent !== undefined && speed && eta) {
              detail = `Downloading: ${percent.toFixed(0)}% at ${speed} (ETA ${eta})`;
            } else if (percent !== undefined) {
              detail = `Downloading: ${percent.toFixed(0)}%`;
            }

            onProgress({
              stage: 'downloading',
              percent,
              speed,
              eta,
              detail,
            });
          }
        }
      }
    });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort);
      }
      if (settled) return;
      settled = true;

      if (code !== 0) {
        console.error(`[yt-dlp download] exit ${code}: ${stderr.slice(0, 500)}`);
        cleanupJob(tmpDir, jobId);
        reject(new Error(stderr));
        return;
      }

      const file = findOutputFile(tmpDir, jobId);
      if (!file) {
        cleanupJob(tmpDir, jobId);
        reject(Object.assign(new Error('Output file not found after download'), { code: 'internal_error' }));
        return;
      }

      // If this was a merge job (video-only format), verify the output is the
      // merged file and not just the intermediate video-only stream.
      // The merged file name is {jobId}.mp4 — no .fNNN. infix.
      // If we only have an intermediate, FFmpeg was missing or failed.
      if (streamType === 'video') {
        const basename = path.basename(file);
        const isIntermediate = /\.f\d+\./.test(basename);
        if (isIntermediate) {
          cleanupJob(tmpDir, jobId);
          reject(Object.assign(
            new Error(
              'FFmpeg merge failed — the merged output file was not produced. ' +
              'Ensure FFmpeg is installed and on PATH (or set FFMPEG_PATH).',
            ),
            { code: 'internal_error' },
          ));
          return;
        }
      }

      try {
        const stat = fs.statSync(file);
        if (stat.size === 0) {
          cleanupJob(tmpDir, jobId);
          reject(Object.assign(new Error('Output file is empty'), { code: 'internal_error' }));
          return;
        }
      } catch {
        cleanupJob(tmpDir, jobId);
        reject(Object.assign(new Error('Cannot stat output file'), { code: 'internal_error' }));
        return;
      }

      const ext = path.extname(file).slice(1);
      resolve({
        filePath: file,
        filename: path.basename(file),
        ext,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      cleanupJob(tmpDir, jobId);
      reject(err);
    });
  });
}

/**
 * Builds a yt-dlp format specifier.
 *
 * - combined → pass the id directly; yt-dlp will use it as-is
 * - video-only → merge with best available audio using the '+' spec;
 *   yt-dlp calls FFmpeg automatically when '+' is used
 * - audio-only → pass the id directly
 */
function buildFormatSpec(formatId: string, streamType: StreamType): string {
  if (streamType === 'video') {
    // Prefer m4a for compatibility with mp4 container; fall back to any best audio
    return `${formatId}+bestaudio[ext=m4a]/bestaudio`;
  }
  return formatId;
}

function findOutputFile(dir: string, jobId: string): string | null {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(jobId));
    if (files.length === 0) return null;

    // Intermediate stream files have an infix like .f229.mp4 or .f140.m4a.
    // The final merged file has no such infix: just {jobId}.mp4.
    // Prefer the clean merged file; fall back to any .mp4; then the first found.
    const merged = files.find((f) => f === `${jobId}.mp4` || f === `${jobId}.webm`);
    if (merged) return path.join(dir, merged);

    const anyMp4 = files.find((f) => f.endsWith('.mp4') && !f.match(/\.f\d+\.mp4$/));
    if (anyMp4) return path.join(dir, anyMp4);

    // Fall back: any mp4, then first file
    const fallbackMp4 = files.find((f) => f.endsWith('.mp4'));
    return path.join(dir, fallbackMp4 ?? files[0]);
  } catch {
    return null;
  }
}

export function cleanupJob(dir: string, jobId: string): void {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(jobId));
    for (const f of files) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch {
    // Best-effort — ignore
  }
}
