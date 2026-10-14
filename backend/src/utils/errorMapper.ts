import { AppErrorCode } from '../types';

interface CodedError extends Error {
  code?: AppErrorCode;
}

/**
 * Maps a raw error (from child-process stderr, yt-dlp exit codes, etc.)
 * to a structured AppErrorCode.  All diagnostic details are logged
 * server-side; only the code + a safe message are sent to the client.
 */
export function mapYtdlpError(err: unknown): { code: AppErrorCode; message: string } {
  const e = err as CodedError;

  // Already mapped by our own code (e.g. URL validator)
  if (e?.code && isAppErrorCode(e.code)) {
    return { code: e.code, message: e.message ?? 'An error occurred' };
  }

  const stderr = (e?.message ?? '').toLowerCase();

  if (stderr.includes('video unavailable') || stderr.includes('this video is not available')) {
    return { code: 'unavailable_video', message: 'This video is unavailable or private.' };
  }
  if (stderr.includes('sign in') || stderr.includes('age-restricted') || stderr.includes('403')) {
    return { code: 'upstream_rejected', message: 'YouTube rejected the request (sign-in or age restriction required).' };
  }
  if (stderr.includes('private video')) {
    return { code: 'unavailable_video', message: 'This video is private.' };
  }
  if (stderr.includes('timed out') || stderr.includes('timeout')) {
    return { code: 'timeout', message: 'The request timed out. Try again later.' };
  }
  if (stderr.includes('requested format not available') || stderr.includes('format not available')) {
    return { code: 'unsupported_format', message: 'The requested format is no longer available.' };
  }

  // Fallback
  return { code: 'internal_error', message: 'An internal error occurred. Check server logs.' };
}

const APP_ERROR_CODES: AppErrorCode[] = [
  'invalid_url',
  'unsupported_url',
  'unavailable_video',
  'upstream_rejected',
  'unsupported_format',
  'timeout',
  'internal_error',
  'rate_limit_exceeded',
  'concurrent_limit_exceeded',
];

function isAppErrorCode(code: string): code is AppErrorCode {
  return (APP_ERROR_CODES as string[]).includes(code);
}
