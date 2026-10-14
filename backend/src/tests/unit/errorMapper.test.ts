import { describe, it, expect } from 'vitest';
import { mapYtdlpError } from '../../utils/errorMapper';

describe('mapYtdlpError', () => {
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

  it('maps "sign in" to upstream_rejected', () => {
    const { code } = mapYtdlpError(new Error('ERROR: Sign in to confirm your age'));
    expect(code).toBe('upstream_rejected');
  });

  it('maps "403" to upstream_rejected', () => {
    const { code } = mapYtdlpError(new Error('HTTP Error 403: Forbidden'));
    expect(code).toBe('upstream_rejected');
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
