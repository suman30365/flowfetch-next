import { FormatInfo } from '../types';

export interface GroupedFormats {
  recommendedVideos: FormatInfo[];
  advancedVideos: FormatInfo[];
  recommendedAudio: FormatInfo | null;
  advancedAudio: FormatInfo[];
  audioFormats: FormatInfo[];
}

export function getNumericResolution(quality: string): number {
  const match = quality.match(/^(\d+)p$/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Normalizes container extension to standard lowercase.
 */
export function normalizeExt(ext: string): string {
  const e = ext.toLowerCase().trim();
  if (e === 'm4v') return 'mp4';
  return e;
}

/**
 * Normalizes codec family for classification.
 */
export function getCodecFamily(f: FormatInfo): string {
  if (f.codecName) return f.codecName;
  if (f.vcodec) {
    const v = f.vcodec.toLowerCase();
    if (v.startsWith('avc') || v.startsWith('h264')) return 'H.264';
    if (v.startsWith('vp09') || v.startsWith('vp9')) return 'VP9';
    if (v.startsWith('av01') || v.startsWith('av1')) return 'AV1';
    if (v.startsWith('hev1') || v.startsWith('h265')) return 'HEVC';
  }
  if (f.acodec) {
    const a = f.acodec.toLowerCase();
    if (a.startsWith('mp4a') || a.includes('aac')) return 'AAC';
    if (a.startsWith('opus')) return 'Opus';
    if (a.includes('mp3')) return 'MP3';
  }
  return 'Standard';
}

/**
 * Groups and deduplicates formats:
 * 1. Groups video formats by resolution only (one recommended per resolution).
 * 2. Selects the best compatible format (prefers MP4 with H.264, standard framerate, SDR).
 * 3. Keeps alternative containers/codecs/framerates in advancedVideos.
 * 4. Selects a single recommended audio format by default, with alternate tiers in advancedAudio.
 * 5. Preserves actual formatId and streamType values.
 */
export function groupAndDeduplicateFormats(formats: FormatInfo[]): GroupedFormats {
  // ── 1. Video Formats ────────────────────────────────────────────────────────
  const rawVideos = formats.filter(
    (f) => f.streamType === 'video+audio' || f.streamType === 'video',
  );

  // Step 1A: Remove redundant identical variants.
  const uniqueVideoVariantsMap = new Map<string, FormatInfo>();

  for (const f of rawVideos) {
    const res = getNumericResolution(f.quality);
    const ext = normalizeExt(f.ext);
    const codec = getCodecFamily(f);
    const fpsKey = f.fps && f.fps >= 50 ? '60fps' : 'std';
    const hdrKey = f.dynamicRange && f.dynamicRange.toUpperCase().includes('HDR') ? 'HDR' : 'SDR';
    const streamTypeKey = f.streamType;

    const variantKey = `${res}-${ext}-${codec}-${fpsKey}-${hdrKey}-${streamTypeKey}`;

    const existing = uniqueVideoVariantsMap.get(variantKey);
    if (!existing) {
      uniqueVideoVariantsMap.set(variantKey, f);
    } else {
      const existingBitrate = existing.tbr ?? 0;
      const currentBitrate = f.tbr ?? 0;
      const existingSize = existing.filesize ?? existing.filesizeApprox ?? 0;
      const currentSize = f.filesize ?? f.filesizeApprox ?? 0;

      // Prefer formats with reliable size metadata over formats without size (e.g. m3u8_native fragments)
      const existingHasSize = existingSize > 0 ? 1 : 0;
      const currentHasSize = currentSize > 0 ? 1 : 0;

      if (currentHasSize !== existingHasSize) {
        if (currentHasSize > existingHasSize) {
          uniqueVideoVariantsMap.set(variantKey, f);
        }
      } else {
        if (currentBitrate > existingBitrate || (currentBitrate === existingBitrate && currentSize > existingSize)) {
          uniqueVideoVariantsMap.set(variantKey, f);
        }
      }
    }
  }

  const distinctVideos = Array.from(uniqueVideoVariantsMap.values());

  // Step 1B: Group all video-capable formats by RESOLUTION ONLY
  // E.g. '2160', '1440', '1080', '720', '480', '360', '240', '144'
  const resGroups = new Map<string, FormatInfo[]>();

  for (const f of distinctVideos) {
    const res = getNumericResolution(f.quality);
    const groupKey = res > 0 ? String(res) : (f.quality || 'unknown');

    const list = resGroups.get(groupKey) ?? [];
    list.push(f);
    resGroups.set(groupKey, list);
  }

  const recommendedVideos: FormatInfo[] = [];
  const advancedVideos: FormatInfo[] = [];

  // Step 1C: Pick exactly ONE recommended format per resolution
  for (const [, variants] of resGroups.entries()) {
    variants.sort((a, b) => {
      const codecA = getCodecFamily(a);
      const codecB = getCodecFamily(b);
      const isH264A = codecA === 'H.264' ? 1 : 0;
      const isH264B = codecB === 'H.264' ? 1 : 0;
      if (isH264B !== isH264A) return isH264B - isH264A;

      const isMp4A = normalizeExt(a.ext) === 'mp4' ? 1 : 0;
      const isMp4B = normalizeExt(b.ext) === 'mp4' ? 1 : 0;
      if (isMp4B !== isMp4A) return isMp4B - isMp4A;

      const isVp9A = codecA === 'VP9' ? 1 : 0;
      const isVp9B = codecB === 'VP9' ? 1 : 0;
      if (isVp9B !== isVp9A) return isVp9B - isVp9A;

      const combA = a.streamType === 'video+audio' ? 1 : 0;
      const combB = b.streamType === 'video+audio' ? 1 : 0;
      if (combB !== combA) return combB - combA;

      // Prefer formats with reliable size metadata
      const hasSizeA = (a.filesize ?? a.filesizeApprox ?? 0) > 0 ? 1 : 0;
      const hasSizeB = (b.filesize ?? b.filesizeApprox ?? 0) > 0 ? 1 : 0;
      if (hasSizeB !== hasSizeA) return hasSizeB - hasSizeA;

      const isStdFpsA = (!a.fps || a.fps <= 35) ? 1 : 0;
      const isStdFpsB = (!b.fps || b.fps <= 35) ? 1 : 0;
      if (isStdFpsB !== isStdFpsA) return isStdFpsB - isStdFpsA;

      const isSdrA = !(a.dynamicRange && a.dynamicRange.toUpperCase().includes('HDR')) ? 1 : 0;
      const isSdrB = !(b.dynamicRange && b.dynamicRange.toUpperCase().includes('HDR')) ? 1 : 0;
      if (isSdrB !== isSdrA) return isSdrB - isSdrA;

      const tbrA = a.tbr ?? 0;
      const tbrB = b.tbr ?? 0;
      if (tbrB !== tbrA) return tbrB - tbrA;

      return (b.filesize ?? 0) - (a.filesize ?? 0);
    });

    recommendedVideos.push(variants[0]);
    for (let i = 1; i < variants.length; i++) {
      advancedVideos.push(variants[i]);
    }
  }

  // Sort from highest to lowest resolution (2160p down to 144p)
  recommendedVideos.sort(compareVideoFormats);
  advancedVideos.sort(compareVideoFormats);

  // ── 2. Audio Formats ────────────────────────────────────────────────────────
  const rawAudio = formats.filter((f) => f.streamType === 'audio');

  const nonDrcAudio = rawAudio.filter((f) => !f.isDrc && !f.formatId.includes('-drc'));
  const candidateAudio = nonDrcAudio.length > 0 ? nonDrcAudio : rawAudio;

  const uniqueAudioMap = new Map<string, FormatInfo>();

  for (const f of candidateAudio) {
    const ext = normalizeExt(f.ext);
    const codec = getCodecFamily(f);
    const rawTbr = f.tbr ?? (parseInt(f.label.match(/(\d+)\s*kbps/i)?.[1] ?? '0', 10));
    const bitrateTier = Math.round(rawTbr / 25) * 25;

    const audioKey = `${ext}-${codec}-${bitrateTier}`;

    const existing = uniqueAudioMap.get(audioKey);
    if (!existing) {
      uniqueAudioMap.set(audioKey, f);
    } else {
      const existingTbr = existing.tbr ?? 0;
      if (rawTbr > existingTbr) {
        uniqueAudioMap.set(audioKey, f);
      }
    }
  }

  const distinctAudio = Array.from(uniqueAudioMap.values());

  distinctAudio.sort((a, b) => {
    const isM4aA = (normalizeExt(a.ext) === 'm4a' || normalizeExt(a.ext) === 'mp4' || getCodecFamily(a) === 'AAC') ? 1 : 0;
    const isM4aB = (normalizeExt(b.ext) === 'm4a' || normalizeExt(b.ext) === 'mp4' || getCodecFamily(b) === 'AAC') ? 1 : 0;
    if (isM4aB !== isM4aA) return isM4aB - isM4aA;

    const tbrA = a.tbr ?? (parseInt(a.label.match(/(\d+)\s*kbps/i)?.[1] ?? '0', 10));
    const tbrB = b.tbr ?? (parseInt(b.label.match(/(\d+)\s*kbps/i)?.[1] ?? '0', 10));
    if (tbrB !== tbrA) return tbrB - tbrA;

    return (b.filesize ?? 0) - (a.filesize ?? 0);
  });

  const recommendedAudio = distinctAudio.length > 0 ? distinctAudio[0] : null;
  const advancedAudio = distinctAudio.slice(1);

  return {
    recommendedVideos,
    advancedVideos,
    recommendedAudio,
    advancedAudio,
    audioFormats: distinctAudio,
  };
}

function compareVideoFormats(a: FormatInfo, b: FormatInfo): number {
  const resA = getNumericResolution(a.quality);
  const resB = getNumericResolution(b.quality);
  if (resB !== resA) return resB - resA;

  // MP4 before WebM
  const isMp4A = a.ext.toLowerCase() === 'mp4' ? 1 : 0;
  const isMp4B = b.ext.toLowerCase() === 'mp4' ? 1 : 0;
  if (isMp4B !== isMp4A) return isMp4B - isMp4A;

  // Higher bitrate
  const tbrA = a.tbr ?? 0;
  const tbrB = b.tbr ?? 0;
  if (tbrB !== tbrA) return tbrB - tbrA;

  return (b.filesize ?? 0) - (a.filesize ?? 0);
}

export interface EstimatedSize {
  bytes?: number;
  label: string;          // e.g. "268 MB", "~268 MB", or "Size unknown"
  isUnknown: boolean;
  isApproximate: boolean;
  breakdown?: {
    videoBytes?: number;
    videoLabel?: string;
    audioBytes?: number;
    audioLabel?: string;
  };
}

export function formatBytes(bytes?: number, isApprox = false): string {
  if (typeof bytes !== 'number' || bytes <= 0 || isNaN(bytes)) return 'Size unknown';
  let formatted = '';
  if (bytes >= 1_000_000_000) {
    formatted = `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  } else if (bytes >= 1_000_000) {
    formatted = `${(bytes / 1_000_000).toFixed(1)} MB`;
  } else if (bytes >= 1_000) {
    formatted = `${(bytes / 1_000).toFixed(0)} KB`;
  } else {
    formatted = `${bytes} B`;
  }
  return isApprox ? `~${formatted}` : formatted;
}

export function getEstimatedFormatSize(
  format: FormatInfo,
  compatibleAudio?: FormatInfo | null,
): EstimatedSize {
  if (format.streamType === 'audio') {
    const bytes = format.filesize ?? format.filesizeApprox;
    if (typeof bytes !== 'number' || bytes <= 0) {
      return { label: 'Size unknown', isUnknown: true, isApproximate: false };
    }
    const isApprox = !!format.isApproximate || !!format.filesizeApprox;
    return {
      bytes,
      label: formatBytes(bytes, isApprox),
      isUnknown: false,
      isApproximate: isApprox,
    };
  }

  if (format.streamType === 'video+audio') {
    const bytes = format.filesize ?? format.filesizeApprox;
    if (typeof bytes !== 'number' || bytes <= 0) {
      return { label: 'Size unknown', isUnknown: true, isApproximate: false };
    }
    const isApprox = !!format.isApproximate || !!format.filesizeApprox;
    return {
      bytes,
      label: formatBytes(bytes, isApprox),
      isUnknown: false,
      isApproximate: isApprox,
    };
  }

  // format.streamType === 'video' (video-only stream)
  const videoBytes = format.filesize ?? format.filesizeApprox;
  const audioBytes = compatibleAudio ? (compatibleAudio.filesize ?? compatibleAudio.filesizeApprox) : undefined;

  if (typeof videoBytes !== 'number' || videoBytes <= 0) {
    return { label: 'Size unknown', isUnknown: true, isApproximate: false };
  }

  const isVideoApprox = !!format.isApproximate || !!format.filesizeApprox;
  const isAudioApprox = compatibleAudio ? (!!compatibleAudio.isApproximate || !!compatibleAudio.filesizeApprox) : false;

  if (typeof audioBytes === 'number' && audioBytes > 0) {
    const totalBytes = videoBytes + audioBytes;
    return {
      bytes: totalBytes,
      label: `~${formatBytes(totalBytes, false)}`,
      isUnknown: false,
      isApproximate: true,
      breakdown: {
        videoBytes,
        videoLabel: formatBytes(videoBytes, isVideoApprox),
        audioBytes,
        audioLabel: formatBytes(audioBytes, isAudioApprox),
      },
    };
  }

  return {
    bytes: videoBytes,
    label: `~${formatBytes(videoBytes, false)}`,
    isUnknown: false,
    isApproximate: true,
    breakdown: {
      videoBytes,
      videoLabel: formatBytes(videoBytes, isVideoApprox),
    },
  };
}
