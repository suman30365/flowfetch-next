import { describe, it, expect } from 'vitest';
import { safeFilename, toAsciiFilename } from '../../utils/filename';

describe('safeFilename', () => {
  it('produces a filename with the correct extension', () => {
    expect(safeFilename('My Video', 'mp4')).toBe('My_Video.mp4');
  });

  it('replaces spaces with underscores', () => {
    expect(safeFilename('Hello World Test', 'webm')).toBe('Hello_World_Test.webm');
  });

  it('strips path traversal characters', () => {
    const result = safeFilename('../../../etc/passwd', 'mp4');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
  });

  it('falls back to "download" for empty title', () => {
    expect(safeFilename('', 'mp4')).toBe('download.mp4');
  });

  it('falls back to "download" for whitespace-only title', () => {
    expect(safeFilename('   ', 'mp4')).toBe('download.mp4');
  });

  it('caps base name at 200 characters', () => {
    const longTitle = 'a'.repeat(300);
    const result = safeFilename(longTitle, 'mp4');
    const base = result.replace('.mp4', '');
    expect(base.length).toBeLessThanOrEqual(200);
  });

  it('sanitises special characters in extension', () => {
    const result = safeFilename('video', '../../../bin/bash');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    expect(result).not.toContain('..');
  });

  it('collapses consecutive underscores', () => {
    const result = safeFilename('Video   !!!   Title', 'mp4');
    expect(result).not.toMatch(/__+/);
  });

  it('handles unicode in titles gracefully', () => {
    const result = safeFilename('Video em Português - ção', 'mp4');
    expect(result).toMatch(/\.mp4$/);
    expect(result.length).toBeGreaterThan(4);
  });
});

describe('toAsciiFilename', () => {
  it('preserves ASCII filenames untouched', () => {
    expect(toAsciiFilename('My_Video.mp4')).toBe('My_Video.mp4');
  });

  it('falls back to download.mp4 for non-ASCII-only filenames (e.g. Tamil title)', () => {
    const tamilTitle = 'மகனைத்_தேடி_அலையும்_ஒரு.mp4';
    const result = toAsciiFilename(tamilTitle);
    expect(result).toBe('download.mp4');
    // Ensure every character is strictly ASCII (code <= 127)
    for (let i = 0; i < result.length; i++) {
      expect(result.charCodeAt(i)).toBeLessThanOrEqual(127);
    }
  });

  it('preserves ASCII portions of mixed filenames', () => {
    const mixed = 'Tamil_Song_2024_தமிழ்.mp4';
    expect(toAsciiFilename(mixed)).toBe('Tamil_Song_2024.mp4');
  });

  it('strips quotes and backslashes to prevent header injection', () => {
    const injected = 'video"name\\test.mp4';
    const result = toAsciiFilename(injected);
    expect(result).not.toContain('"');
    expect(result).not.toContain('\\');
  });
});
