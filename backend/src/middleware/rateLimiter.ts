import { Request, Response, NextFunction } from 'express';
import rateLimit, { Options } from 'express-rate-limit';

const isDev = process.env.NODE_ENV === 'development';
const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);

interface CreateLimiterOptions {
  windowMs?: number;
  max: number;
  message?: string;
}

export function createLimiter(opts: CreateLimiterOptions) {
  const effectiveWindowMs = opts.windowMs ?? windowMs;
  return rateLimit({
    windowMs: effectiveWindowMs,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req: Request) => process.env.NODE_ENV === 'test' && req.headers['x-test-rate-limit'] !== 'true',
    handler: (req: Request, res: Response, _next: NextFunction, options: Options) => {
      const headerVal = res.getHeader('Retry-After');
      const retryAfter = headerVal ? parseInt(String(headerVal), 10) : Math.ceil(effectiveWindowMs / 1000);
      res.status(options.statusCode).json({
        error: 'rate_limit_exceeded',
        message: opts.message ?? 'Too many requests — please slow down.',
        retryAfter,
      });
    },
  });
}

// ── 1. Analyze Rate Limiter (CPU/network intensive yt-dlp metadata extraction)
export const analyzeLimiter = createLimiter({
  max: parseInt(process.env.RATE_LIMIT_ANALYZE_MAX ?? (isDev ? '60' : '20'), 10),
  message: 'Too many analyze requests — please slow down.',
});

// ── 2. Download Preparation Rate Limiter (yt-dlp + ffmpeg merge initiation)
export const downloadPrepareLimiter = createLimiter({
  max: parseInt(process.env.RATE_LIMIT_DOWNLOAD_MAX ?? (isDev ? '30' : '10'), 10),
  message: 'Too many download requests — please slow down.',
});

// ── 3. Status Polling Rate Limiter (Lightweight in-memory lookup every 1s)
// Isolated bucket: status polling never burns the analyze or download quota!
export const downloadStatusLimiter = createLimiter({
  max: parseInt(process.env.RATE_LIMIT_STATUS_MAX ?? (isDev ? '180' : '120'), 10),
  message: 'Too many status check requests — please slow down.',
});

// ── 4. File Streaming / Actions Limiter (Binary downloads and cancellations)
export const downloadFileLimiter = createLimiter({
  max: parseInt(process.env.RATE_LIMIT_FILE_MAX ?? (isDev ? '60' : '30'), 10),
  message: 'Too many file stream requests — please slow down.',
});
