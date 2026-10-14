import { describe, it, expect } from 'vitest';
import { mapYtdlpError, sanitizeDiagnostic } from '../../utils/errorMapper';

describe('mapYtdlpError', () => {
  it('maps YouTube bot detection accurately without claiming age restriction', () => {
    const err = new Error('ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you’re not a bot. This helps protect our community.');
    const { code, message } = mapYtdlpError(err);
    expect(code).toBe('upstream_rejected');
    expect(message).toContain('bot challenge');
    expect(message).not.toContain('age restriction');
  });

  it('maps ASCII apostrophe bot detection accurately', () => {
    const err = new Error("ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you're not a bot.");
    const { code, message } = mapYtdlpError(err);
    expect(code).toBe('upstream_rejected');
    expect(message).toContain('bot challenge');
    expect(message).not.toContain('age restriction');
  });

  it('maps true age restriction accurately', () => {
    const err = new Error('ERROR: Sign in to confirm your age');
    const { code, message } = mapYtdlpError(err);
    expect(code).toBe('upstream_rejected');
    expect(message).toContain('age-restricted');
  });

  it('maps HTTP 429 Too Many Requests to rate_limit_exceeded', () => {
    const err = new Error('ERROR: [youtube] HTTP Error 429: Too Many Requests');
    const { code, message } = mapYtdlpError(err);
    expect(code).toBe('rate_limit_exceeded');
    expect(message).toContain('rate-limiting');
  });

  it('maps HTTP 403 Forbidden accurately', () => {
    const err = new Error('ERROR: [youtube] HTTP Error 403: Forbidden');
    const { code, message } = mapYtdlpError(err);
    expect(code).toBe('upstream_rejected');
    expect(message).toContain('403 Forbidden');
    expect(message).not.toContain('age restriction');
  });

  it('maps geo-blocking accurately', () => {
    const err = new Error('ERROR: [youtube] The uploader has not made this video available in your country');
    const { code, message } = mapYtdlpError(err);
    expect(code).toBe('upstream_rejected');
    expect(message).toContain('geo-restricted');
  });

  it('maps "Video unavailable" to unavailable_video', () => {
    const { code } = mapYtdlpError(new Error('ERROR: Video unavailable'));
    expect(code).toBe('unavailable_video');
  });

  it('maps "this video is not available" to unavailable_video', () => {
    const { code } = mapYtdlpError(new Error('this video is not available'));
    expect(code).toBe('unavailable_video');
  });

  it('maps "private video" to unavailable_video', () => {
    const { code } = mapYtdlpError(new Error('ERROR: Private video'));
    expect(code).toBe('unavailable_video');
  });

  it('maps "timed out" to timeout', () => {
    const { code } = mapYtdlpError(new Error('Request timed out'));
    expect(code).toBe('timeout');
  });

  it('maps "requested format not available" to unsupported_format', () => {
    const { code } = mapYtdlpError(new Error('Requested format not available'));
    expect(code).toBe('unsupported_format');
  });

  it('maps unknown error to internal_error', () => {
    const { code } = mapYtdlpError(new Error('Something completely unknown'));
    expect(code).toBe('internal_error');
  });

  it('passes through already-mapped codes', () => {
    const err = Object.assign(new Error('Invalid URL'), { code: 'invalid_url' });
    const { code } = mapYtdlpError(err);
    expect(code).toBe('invalid_url');
  });

  it('handles non-Error objects gracefully', () => {
    const { code } = mapYtdlpError('just a string');
    expect(code).toBe('internal_error');
  });

  it('handles null gracefully', () => {
    const { code } = mapYtdlpError(null);
    expect(code).toBe('internal_error');
  });
});

describe('sanitizeDiagnostic', () => {
  it('redacts cookies and session tokens from diagnostic text', () => {
    const raw = 'Command failed with cookie: SID=abc123xyz; HSID=def456; __Secure-3PAPISID=secret123 and --cookies /tmp/cookies.txt';
    const sanitized = sanitizeDiagnostic(raw);
    expect(sanitized).not.toContain('abc123xyz');
    expect(sanitized).not.toContain('def456');
    expect(sanitized).not.toContain('secret123');
    expect(sanitized).not.toContain('/tmp/cookies.txt');
    expect(sanitized).toContain('[REDACTED');
  });

  it('redacts Authorization bearer tokens and secret parameters', () => {
    const raw = 'Error fetching https://example.com/api?token=secret_token_123 with Authorization: Bearer eyJhbGciOi...';
    const sanitized = sanitizeDiagnostic(raw);
    expect(sanitized).not.toContain('secret_token_123');
    expect(sanitized).not.toContain('eyJhbGciOi');
    expect(sanitized).toContain('token=[REDACTED]');
    expect(sanitized).toContain('Bearer [REDACTED]');
  });
});
