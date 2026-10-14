import { describe, it, expect } from 'vitest';
import { groupAndDeduplicateFormats, getEstimatedFormatSize, formatBytes } from '../../utils/formatGrouping';
import { FormatInfo } from '../../types';

describe('groupAndDeduplicateFormats', () => {
  it('prioritizes formats with reliable size metadata and deduplicates redundant variants', () => {
    const rawFormats: FormatInfo[] = [
      { formatId: '229', label: '240p · MP4 · 245kbps', ext: 'mp4', quality: '240p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 245, vcodec: 'avc1.4D400C', codecName: 'H.264', fps: 15 },
      { formatId: '230', label: '240p · MP4 · 295kbps', ext: 'mp4', quality: '240p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 295, vcodec: 'avc1.4D400C', codecName: 'H.264', fps: 15 },
      { formatId: '134', label: '240p · MP4 · 136kbps', ext: 'mp4', quality: '240p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 136, vcodec: 'avc1.4D400C', codecName: 'H.264', fps: 15, filesize: 322379 },
      { formatId: '133', label: '240p · MP4 · 183kbps', ext: 'mp4', quality: '240p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 183, vcodec: 'avc1.4D400C', codecName: 'H.264', fps: 15, filesize: 433081 },
    ];

    const result = groupAndDeduplicateFormats(rawFormats);

    // Exactly one recommended format should be chosen for 240p
    expect(result.recommendedVideos).toHaveLength(1);
    // Format 133 is picked because it has verified filesize metadata (over 230 which has no size)
    expect(result.recommendedVideos[0].formatId).toBe('133');
    expect(result.recommendedVideos[0].quality).toBe('240p');
    expect(result.recommendedVideos[0].ext).toBe('mp4');
    expect(result.advancedVideos).toHaveLength(0);
  });

  it('picks the highest bitrate format when all variants have reliable size metadata', () => {
    const rawFormats: FormatInfo[] = [
      { formatId: '134', label: '240p · MP4 · 136kbps', ext: 'mp4', quality: '240p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 136, vcodec: 'avc1.4D400C', codecName: 'H.264', fps: 15, filesize: 322379 },
      { formatId: '133', label: '240p · MP4 · 183kbps', ext: 'mp4', quality: '240p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 183, vcodec: 'avc1.4D400C', codecName: 'H.264', fps: 15, filesize: 433081 },
    ];

    const result = groupAndDeduplicateFormats(rawFormats);
    expect(result.recommendedVideos).toHaveLength(1);
    expect(result.recommendedVideos[0].formatId).toBe('133'); // highest bitrate
  });

  it('ensures each resolution appears at most once in recommendedVideos even when yt-dlp returns MP4 and WEBM variants', () => {
    const rawFormats: FormatInfo[] = [
      // 1080p MP4 H.264
      { formatId: '137', label: '1080p · MP4 · H.264', ext: 'mp4', quality: '1080p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 4000, vcodec: 'avc1.640028', codecName: 'H.264', fps: 30 },
      // 1080p MP4 AV1
      { formatId: '399', label: '1080p · MP4 · AV1', ext: 'mp4', quality: '1080p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 2500, vcodec: 'av01.0.08M.08', codecName: 'AV1', fps: 30 },
      // 1080p WEBM VP9
      { formatId: '248', label: '1080p · WEBM · VP9', ext: 'webm', quality: '1080p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 3000, vcodec: 'vp9', codecName: 'VP9', fps: 30 },
      // 720p MP4 H.264 (combined)
      { formatId: '22', label: '720p · MP4 · combined', ext: 'mp4', quality: '720p', streamType: 'video+audio', hasAudio: true, hasVideo: true, tbr: 1200, vcodec: 'avc1.64001F', codecName: 'H.264' },
      // 720p WEBM VP9
      { formatId: '247', label: '720p · WEBM · VP9', ext: 'webm', quality: '720p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 1500, vcodec: 'vp9', codecName: 'VP9' },
    ];

    const result = groupAndDeduplicateFormats(rawFormats);

    // Primary selector must show exactly ONE format per resolution (1080p and 720p)
    expect(result.recommendedVideos).toHaveLength(2);

    const resolutions = result.recommendedVideos.map((f) => f.quality);
    expect(resolutions).toEqual(['1080p', '720p']);
    // No duplicate resolutions
    expect(new Set(resolutions).size).toBe(resolutions.length);

    // 1080p recommended must be MP4 H.264 (format 137)
    expect(result.recommendedVideos[0].formatId).toBe('137');
    expect(result.recommendedVideos[0].ext).toBe('mp4');
    expect(result.recommendedVideos[0].codecName).toBe('H.264');

    // 720p recommended must be format 22
    expect(result.recommendedVideos[1].formatId).toBe('22');
    expect(result.recommendedVideos[1].streamType).toBe('video+audio');

    // Alternative variants (1080p AV1, 1080p VP9, 720p VP9) are in advancedVideos
    expect(result.advancedVideos).toHaveLength(3);
    const advancedIds = result.advancedVideos.map((f) => f.formatId);
    expect(advancedIds).toContain('248'); // 1080p VP9
    expect(advancedIds).toContain('399'); // 1080p AV1
    expect(advancedIds).toContain('247'); // 720p VP9
  });

  it('selects best supported alternative (VP9 over AV1) when H.264 is unavailable at 2160p (4K)', () => {
    const rawFormats: FormatInfo[] = [
      // 2160p WebM AV1
      { formatId: '401', label: '2160p · WEBM · AV1', ext: 'webm', quality: '2160p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 12000, vcodec: 'av01.0.12M.08', codecName: 'AV1' },
      // 2160p WebM VP9
      { formatId: '313', label: '2160p · WEBM · VP9', ext: 'webm', quality: '2160p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 15000, vcodec: 'vp9', codecName: 'VP9' },
    ];

    const result = groupAndDeduplicateFormats(rawFormats);

    expect(result.recommendedVideos).toHaveLength(1);
    expect(result.recommendedVideos[0].quality).toBe('2160p');
    expect(result.recommendedVideos[0].formatId).toBe('313'); // VP9 preferred over AV1 for compatibility
    expect(result.advancedVideos).toHaveLength(1);
    expect(result.advancedVideos[0].formatId).toBe('401');
  });

  it('sorts recommendedVideos strictly from highest to lowest resolution', () => {
    const rawFormats: FormatInfo[] = [
      { formatId: '160', label: '144p', ext: 'mp4', quality: '144p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 100 },
      { formatId: '313', label: '2160p', ext: 'webm', quality: '2160p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 15000 },
      { formatId: '137', label: '1080p', ext: 'mp4', quality: '1080p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 4000 },
      { formatId: '22', label: '720p', ext: 'mp4', quality: '720p', streamType: 'video+audio', hasAudio: true, hasVideo: true, tbr: 1200 },
      { formatId: '135', label: '480p', ext: 'mp4', quality: '480p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 800 },
      { formatId: '134', label: '360p', ext: 'mp4', quality: '360p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 500 },
      { formatId: '133', label: '240p', ext: 'mp4', quality: '240p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 300 },
      { formatId: '271', label: '1440p', ext: 'webm', quality: '1440p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 8000 },
    ];

    const result = groupAndDeduplicateFormats(rawFormats);

    const orderedResolutions = result.recommendedVideos.map((f) => f.quality);
    expect(orderedResolutions).toEqual([
      '2160p',
      '1440p',
      '1080p',
      '720p',
      '480p',
      '360p',
      '240p',
      '144p',
    ]);
  });

  it('separates audio-only formats and selects a single recommended audio track', () => {
    const rawFormats: FormatInfo[] = [
      { formatId: '137', label: '1080p · MP4', ext: 'mp4', quality: '1080p', streamType: 'video', hasAudio: false, hasVideo: true, tbr: 4000 },
      // Audio formats
      { formatId: '140', label: 'M4A · audio · 130kbps', ext: 'm4a', quality: 'unknown', streamType: 'audio', hasAudio: true, hasVideo: false, tbr: 130, acodec: 'mp4a.40.2', codecName: 'AAC' },
      { formatId: '139', label: 'M4A · audio · 48kbps', ext: 'm4a', quality: 'unknown', streamType: 'audio', hasAudio: true, hasVideo: false, tbr: 48, acodec: 'mp4a.40.2', codecName: 'AAC' },
      { formatId: '251', label: 'WEBM · audio · 130kbps', ext: 'webm', quality: 'unknown', streamType: 'audio', hasAudio: true, hasVideo: false, tbr: 130, acodec: 'opus', codecName: 'Opus' },
    ];

    const result = groupAndDeduplicateFormats(rawFormats);

    // Audio format never appears in video lists
    expect(result.recommendedVideos.some((f) => f.streamType === 'audio')).toBe(false);
    expect(result.advancedVideos.some((f) => f.streamType === 'audio')).toBe(false);

    // Single recommended audio format selected (AAC/M4A 130kbps)
    expect(result.recommendedAudio).not.toBeNull();
    expect(result.recommendedAudio?.formatId).toBe('140');
    expect(result.recommendedAudio?.ext).toBe('m4a');
    expect(result.recommendedAudio?.codecName).toBe('AAC');

    // Other audio options in advancedAudio
    expect(result.advancedAudio).toHaveLength(2);
    expect(result.advancedAudio.map((f) => f.formatId)).toContain('139');
    expect(result.advancedAudio.map((f) => f.formatId)).toContain('251');
  });

  it('filters redundant -drc audio duplicates when standard non-DRC audio exists', () => {
    const rawFormats: FormatInfo[] = [
      { formatId: '140', label: 'M4A · audio only · 130kbps', ext: 'm4a', quality: '3', streamType: 'audio', hasAudio: true, hasVideo: false, tbr: 130, acodec: 'mp4a.40.2', codecName: 'AAC', isDrc: false },
      { formatId: '140-drc', label: 'M4A · audio only · 130kbps', ext: 'm4a', quality: '2.5', streamType: 'audio', hasAudio: true, hasVideo: false, tbr: 130, acodec: 'mp4a.40.2', codecName: 'AAC', isDrc: true },
      { formatId: '251', label: 'WEBM · audio only · 106kbps', ext: 'webm', quality: '3', streamType: 'audio', hasAudio: true, hasVideo: false, tbr: 106, acodec: 'opus', codecName: 'Opus', isDrc: false },
      { formatId: '251-drc', label: 'WEBM · audio only · 107kbps', ext: 'webm', quality: '2.5', streamType: 'audio', hasAudio: true, hasVideo: false, tbr: 107, acodec: 'opus', codecName: 'Opus', isDrc: true },
    ];

    const result = groupAndDeduplicateFormats(rawFormats);

    expect(result.audioFormats).toHaveLength(2);
    expect(result.audioFormats.map((f) => f.formatId)).toContain('140');
    expect(result.audioFormats.map((f) => f.formatId)).toContain('251');
    expect(result.audioFormats.map((f) => f.formatId)).not.toContain('140-drc');
    expect(result.audioFormats.map((f) => f.formatId)).not.toContain('251-drc');
  });

  it('preserves exact backend formatId and streamType values', () => {
    const rawFormats: FormatInfo[] = [
      { formatId: '22', label: '720p · MP4 · complete', ext: 'mp4', quality: '720p', streamType: 'video+audio', hasAudio: true, hasVideo: true, tbr: 1200 },
      { formatId: '140', label: 'M4A · audio', ext: 'm4a', quality: 'unknown', streamType: 'audio', hasAudio: true, hasVideo: false, tbr: 128 },
    ];

    const result = groupAndDeduplicateFormats(rawFormats);

    expect(result.recommendedVideos[0].formatId).toBe('22');
    expect(result.recommendedVideos[0].streamType).toBe('video+audio');
    expect(result.recommendedAudio?.formatId).toBe('140');
    expect(result.recommendedAudio?.streamType).toBe('audio');
  });
});

describe('getEstimatedFormatSize and formatBytes', () => {
  it('formats byte numbers into human-readable strings with optional approx indicator', () => {
    expect(formatBytes(1500, false)).toBe('2 KB');
    expect(formatBytes(10_500_000, false)).toBe('10.5 MB');
    expect(formatBytes(1_200_000_000, false)).toBe('1.2 GB');
    expect(formatBytes(10_500_000, true)).toBe('~10.5 MB');
    expect(formatBytes(0)).toBe('Size unknown');
    expect(formatBytes(undefined)).toBe('Size unknown');
  });

  it('calculates estimated total size for video-only streams with compatible audio', () => {
    const videoFormat: FormatInfo = {
      formatId: '137',
      label: '1080p MP4',
      ext: 'mp4',
      quality: '1080p',
      streamType: 'video',
      hasAudio: false,
      hasVideo: true,
      filesize: 100_000_000, // 100 MB
    };
    const audioFormat: FormatInfo = {
      formatId: '140',
      label: 'M4A audio',
      ext: 'm4a',
      quality: 'unknown',
      streamType: 'audio',
      hasAudio: true,
      hasVideo: false,
      filesize: 10_000_000, // 10 MB
    };

    const est = getEstimatedFormatSize(videoFormat, audioFormat);
    expect(est.isUnknown).toBe(false);
    expect(est.bytes).toBe(110_000_000);
    expect(est.label).toBe('~110.0 MB');
    expect(est.isApproximate).toBe(true);
    expect(est.breakdown?.videoBytes).toBe(100_000_000);
    expect(est.breakdown?.videoLabel).toBe('100.0 MB');
    expect(est.breakdown?.audioBytes).toBe(10_000_000);
    expect(est.breakdown?.audioLabel).toBe('10.0 MB');
  });

  it('uses actual combined format size for combined video+audio formats', () => {
    const combinedFormat: FormatInfo = {
      formatId: '22',
      label: '720p MP4 combined',
      ext: 'mp4',
      quality: '720p',
      streamType: 'video+audio',
      hasAudio: true,
      hasVideo: true,
      filesize: 45_000_000,
    };

    const est = getEstimatedFormatSize(combinedFormat);
    expect(est.isUnknown).toBe(false);
    expect(est.bytes).toBe(45_000_000);
    expect(est.label).toBe('45.0 MB');
    expect(est.isApproximate).toBe(false);
  });

  it('respects filesizeApprox and marks approximate estimates with ~ prefix', () => {
    const approxCombined: FormatInfo = {
      formatId: '18',
      label: '360p MP4',
      ext: 'mp4',
      quality: '360p',
      streamType: 'video+audio',
      hasAudio: true,
      hasVideo: true,
      filesizeApprox: 12_500_000,
      isApproximate: true,
    };

    const est = getEstimatedFormatSize(approxCombined);
    expect(est.isUnknown).toBe(false);
    expect(est.bytes).toBe(12_500_000);
    expect(est.label).toBe('~12.5 MB');
    expect(est.isApproximate).toBe(true);
  });

  it('returns "Size unknown" when reliable metadata is absent instead of inventing a number', () => {
    const unknownFormat: FormatInfo = {
      formatId: '230',
      label: '240p HLS',
      ext: 'mp4',
      quality: '240p',
      streamType: 'video',
      hasAudio: false,
      hasVideo: true,
    };

    const est = getEstimatedFormatSize(unknownFormat);
    expect(est.isUnknown).toBe(true);
    expect(est.label).toBe('Size unknown');
    expect(est.bytes).toBeUndefined();
  });

  it('formats audio-only stream size directly', () => {
    const audioFormat: FormatInfo = {
      formatId: '140',
      label: 'M4A audio',
      ext: 'm4a',
      quality: 'unknown',
      streamType: 'audio',
      hasAudio: true,
      hasVideo: false,
      filesize: 10_300_000,
    };

    const est = getEstimatedFormatSize(audioFormat);
    expect(est.isUnknown).toBe(false);
    expect(est.label).toBe('10.3 MB');
    expect(est.isApproximate).toBe(false);
  });
});
