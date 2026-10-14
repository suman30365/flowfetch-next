import { describe, it, expect } from 'vitest';
import { validateYouTubeUrl } from '../../utils/urlValidator';

describe('validateYouTubeUrl', () => {
  // ── Valid URLs ────────────────────────────────────────────────────────────

  it('accepts standard watch URL', () => {
    const result = validateYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('accepts youtu.be short URL', () => {
    const result = validateYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(result).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('accepts youtube.com without www', () => {
    const result = validateYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('accepts m.youtube.com (mobile)', () => {
    const result = validateYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('accepts YouTube Shorts URL', () => {
    const result = validateYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    expect(result).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('normalises URL with extra query params', () => {
    const result = validateYouTubeUrl(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42',
    );
    expect(result).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('strips leading/trailing whitespace', () => {
    const result = validateYouTubeUrl('  https://youtu.be/dQw4w9WgXcQ  ');
    expect(result).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  // ── Rejected: bad protocol ────────────────────────────────────────────────

  it('rejects http:// URLs', () => {
    expect(() => validateYouTubeUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toThrow();
  });

  it('rejects javascript: protocol', () => {
    expect(() => validateYouTubeUrl('javascript:alert(1)')).toThrow();
  });

  it('rejects ftp:// URLs', () => {
    expect(() => validateYouTubeUrl('ftp://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toThrow();
  });

  // ── Rejected: private / loopback hosts (SSRF) ─────────────────────────────

  it('rejects localhost', () => {
    expect(() => validateYouTubeUrl('https://localhost/watch?v=dQw4w9WgXcQ')).toThrow();
  });

  it('rejects 127.0.0.1', () => {
    expect(() => validateYouTubeUrl('https://127.0.0.1/watch?v=dQw4w9WgXcQ')).toThrow();
  });

  it('rejects 10.0.0.1', () => {
    expect(() => validateYouTubeUrl('https://10.0.0.1/watch?v=dQw4w9WgXcQ')).toThrow();
  });

  it('rejects 192.168.1.1', () => {
    expect(() => validateYouTubeUrl('https://192.168.1.1/watch?v=dQw4w9WgXcQ')).toThrow();
  });

  // ── Rejected: unsupported host ────────────────────────────────────────────

  it('rejects vimeo.com', () => {
    expect(() => validateYouTubeUrl('https://vimeo.com/123456')).toThrow();
  });

  it('rejects example.com', () => {
    expect(() => validateYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toThrow();
  });

  // ── Rejected: bad / missing video ID ─────────────────────────────────────

  it('rejects YouTube channel URL (no video ID)', () => {
    expect(() => validateYouTubeUrl('https://www.youtube.com/channel/UCxxxxxx')).toThrow();
  });

  it('rejects playlist-only URL', () => {
    expect(() =>
      validateYouTubeUrl('https://www.youtube.com/playlist?list=PLabcdefg'),
    ).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateYouTubeUrl('')).toThrow();
  });

  it('rejects URL with invalid video ID length', () => {
    expect(() =>
      validateYouTubeUrl('https://www.youtube.com/watch?v=SHORT'),
    ).toThrow();
  });

  it('rejects URL that is too long', () => {
    expect(() => validateYouTubeUrl('https://youtu.be/' + 'a'.repeat(3000))).toThrow();
  });

  it('rejects malformed URL', () => {
    expect(() => validateYouTubeUrl('not-a-url')).toThrow();
  });
});
