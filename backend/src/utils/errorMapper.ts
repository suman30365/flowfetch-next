import { AppErrorCode } from '../types';

interface CodedError extends Error {
  code?: AppErrorCode;
}

export interface MappedError {
  code: AppErrorCode;
  message: string;
  diagnostic: string;
}

/**
 * Sanitizes diagnostic text for server-side logging.
 * Strips cookies, auth tokens, session IDs, and secret parameters.
 */
export function sanitizeDiagnostic(text: string): string {
  if (!text) return '';
  return text
    // Strip cookie headers or flags
    .replace(/(?:--cookies\s+[^\s]+|cookie:\s*[^\r\n]+)/gi, '[REDACTED_COOKIE]')
    // Strip YouTube/Google auth tokens (SID, HSID, SSID, APISID, SAPISID, LOGIN_INFO, PO token)
    .replace(/\b(?:SID|HSID|SSID|APISID|SAPISID|LOGIN_INFO|__Secure-[^=]+|po_token)=[^;&\s]+/gi, '$1=[REDACTED]')
    // Strip authorization / bearer tokens
    .replace(/(?:Authorization:\s*Bearer\s+|Bearer\s+)[^\r\n\s]+/gi, 'Bearer [REDACTED]')
    // Strip query parameters containing secrets/tokens
    .replace(/([?&](?:key|token|auth|password|secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .trim();
}

/**
 * Maps a raw error (from child-process stderr, yt-dlp exit codes, etc.)
 * to a structured AppErrorCode and an honest, accurate message.
 *
 * All diagnostic details are sanitized and kept server-side;
 * only the code + safe user message are sent to the client.
 */
export function mapYtdlpError(err: unknown): MappedError {
  const e = err as CodedError;

  const raw = e?.message ?? (typeof err === 'string' ? err : '');
  const diagnostic = sanitizeDiagnostic(raw);

  // Already mapped by our own code (e.g. URL validator)
  if (e?.code && isAppErrorCode(e.code)) {
    return { code: e.code, message: e.message ?? 'An error occurred', diagnostic };
  }

  const stderr = raw.toLowerCase();

  // 1. YouTube Bot Detection / Cloud Datacenter IP Challenge
  // MUST be checked before generic "sign in" because the message contains "Sign in to confirm you’re not a bot"
  if (
    stderr.includes('confirm you’re not a bot') ||
    stderr.includes("confirm you're not a bot") ||
    stderr.includes('not a bot') ||
    stderr.includes('bot detection') ||
    stderr.includes('automated queries')
  ) {
    return {
      code: 'upstream_rejected',
      message: 'YouTube detected automated traffic from this server (bot challenge). Please try again or use another video.',
      diagnostic,
    };
  }

  // 2. HTTP 429 Too Many Requests (Rate limit from YouTube)
  if (stderr.includes('429') || stderr.includes('too many requests')) {
    return {
      code: 'rate_limit_exceeded',
      message: 'YouTube is currently rate-limiting requests from this server. Please try again later.',
      diagnostic,
    };
  }

  // 3. HTTP 403 Forbidden
  if (stderr.includes('http error 403') || stderr.includes('403: forbidden') || stderr.includes('forbidden')) {
    return {
      code: 'upstream_rejected',
      message: 'YouTube refused access (HTTP 403 Forbidden).',
      diagnostic,
    };
  }

  // 4. Geo-blocking / Regional restrictions
  if (
    stderr.includes('in your country') ||
    stderr.includes('not available in your country') ||
    stderr.includes('blocked it in your country') ||
    stderr.includes('geo-restricted') ||
    stderr.includes('geographic restriction')
  ) {
    return {
      code: 'upstream_rejected',
      message: 'This video is not available in the server’s region (geo-restricted).',
      diagnostic,
    };
  }

  // 5. True Age restriction or Account Sign-in requirement for the video content
  if (
    stderr.includes('age-restricted') ||
    stderr.includes('confirm your age') ||
    stderr.includes('inappropriate for some users') ||
    stderr.includes('sign in to view') ||
    (stderr.includes('sign in') && !stderr.includes('bot'))
  ) {
    return {
      code: 'upstream_rejected',
      message: 'This video is age-restricted and requires signing in to YouTube.',
      diagnostic,
    };
  }

  // 6. Video Unavailable / Private
  if (stderr.includes('private video') || stderr.includes('this is a private video')) {
    return { code: 'unavailable_video', message: 'This video is private.', diagnostic };
  }
  if (stderr.includes('video unavailable') || stderr.includes('this video is not available')) {
    return { code: 'unavailable_video', message: 'This video is unavailable or has been removed.', diagnostic };
  }

  // 7. Timeouts
  if (stderr.includes('timed out') || stderr.includes('timeout')) {
    return { code: 'timeout', message: 'The request to YouTube timed out. Try again later.', diagnostic };
  }

  // 8. Unsupported / Missing format
  if (stderr.includes('requested format not available') || stderr.includes('format not available')) {
    return { code: 'unsupported_format', message: 'The requested format is no longer available.', diagnostic };
  }

  // Fallback
  return { code: 'internal_error', message: 'An internal error occurred. Check server logs.', diagnostic };
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
