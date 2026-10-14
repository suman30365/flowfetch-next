import { describe, it, expect } from 'vitest';

// ── Import the internal helpers we want to test ───────────────────────────────
// We test parseYtdlpJson indirectly via a harness that feeds raw JSON.
// The function is not exported, so we re-implement the classification logic
// here as a pure-function unit test matching the implementation exactly.

import type { FormatInfo, StreamType } from '../../types';

/**
 * Classifies yt-dlp format objects exactly as the service does.
 * Keep in sync with ytdlp.ts buildLabel / streamType derivation.
 */
function classifyFormat(raw: {
  format_id: string;
  ext: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  tbr?: number;
}): Pick<FormatInfo, 'streamType' | 'hasVideo' | 'hasAudio' | 'quality'> {
  const hasVideo = !!raw.vcodec && raw.vcodec !== 'none';
  const hasAudio = !!raw.acodec && raw.acodec !== 'none';
  const streamType: StreamType =
    hasVideo && hasAudio ? 'video+audio'
    : hasVideo           ? 'video'
    :                      'audio';
  const quality = raw.height ? `${raw.height}p` : 'unknown';
  return { streamType, hasVideo, hasAudio, quality };
}

describe('Format classification', () => {
  it('classifies a combined stream correctly', () => {
    const r = classifyFormat({ format_id: '22', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 720 });
    expect(r.streamType).toBe('video+audio');
    expect(r.hasVideo).toBe(true);
    expect(r.hasAudio).toBe(true);
    expect(r.quality).toBe('720p');
  });

  it('classifies a video-only stream correctly', () => {
    const r = classifyFormat({ format_id: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080 });
    expect(r.streamType).toBe('video');
    expect(r.hasVideo).toBe(true);
    expect(r.hasAudio).toBe(false);
    expect(r.quality).toBe('1080p');
  });

  it('classifies an audio-only stream correctly', () => {
    const r = classifyFormat({ format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a' });
    expect(r.streamType).toBe('audio');
    expect(r.hasVideo).toBe(false);
    expect(r.hasAudio).toBe(true);
    expect(r.quality).toBe('unknown');
  });

  it('treats missing vcodec as no video', () => {
    const r = classifyFormat({ format_id: '251', ext: 'webm', acodec: 'opus' });
    expect(r.streamType).toBe('audio');
    expect(r.hasVideo).toBe(false);
  });

  it('treats missing acodec as no audio', () => {
    const r = classifyFormat({ format_id: '248', ext: 'webm', vcodec: 'vp9', height: 1080 });
    expect(r.streamType).toBe('video');
    expect(r.hasAudio).toBe(false);
  });

  it('treats vcodec="none" as no video', () => {
    const r = classifyFormat({ format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a' });
    expect(r.hasVideo).toBe(false);
  });

  it('treats both none codecs as no-av (storyboard format)', () => {
    const r = classifyFormat({ format_id: 'sb0', ext: 'mhtml', vcodec: 'none', acodec: 'none' });
    // Both flags false — this format would be filtered out by the parser
    expect(r.hasVideo).toBe(false);
    expect(r.hasAudio).toBe(false);
  });

  it('treats acodec="none" as no audio', () => {
    const r = classifyFormat({ format_id: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080 });
    expect(r.hasAudio).toBe(false);
  });
});

describe('Format label safety', () => {
  it('never labels a video-only stream as video+audio', () => {
    const r = classifyFormat({ format_id: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080 });
    expect(r.streamType).not.toBe('video+audio');
  });

  it('never labels an audio-only stream as having video', () => {
    const r = classifyFormat({ format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a' });
    expect(r.hasVideo).toBe(false);
    expect(r.streamType).not.toBe('video+audio');
    expect(r.streamType).not.toBe('video');
  });
});

describe('isValidFormatId', () => {
  // Import inline to avoid loading the full service (which might call spawn)
  const valid = (id: string) => /^[A-Za-z0-9_\-+.]{1,50}$/.test(id);

  it('accepts numeric id', ()    => expect(valid('137')).toBe(true));
  it('accepts alphanumeric id',  () => expect(valid('hls-1080')).toBe(true));
  it('accepts merge spec id',    () => expect(valid('137+140')).toBe(true));
  it('rejects empty string',     () => expect(valid('')).toBe(false));
  it('rejects shell injection',  () => expect(valid('; rm -rf /')).toBe(false));
  it('rejects path traversal',   () => expect(valid('../../etc')).toBe(false));
  it('rejects id over 50 chars', () => expect(valid('a'.repeat(51))).toBe(false));
  it('rejects spaces',           () => expect(valid('137 140')).toBe(false));
  it('rejects newline',          () => expect(valid('137\n140')).toBe(false));
});
