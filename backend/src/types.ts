// ── API request / response shapes ─────────────────────────────────────────────

export interface AnalyzeRequest {
  url: string;
}

export type StreamType = 'video+audio' | 'video' | 'audio';

export interface FormatInfo {
  formatId: string;
  label: string;       // human-readable, e.g. "1080p · MP4 · video+audio"
  ext: string;
  quality: string;
  streamType: StreamType;  // explicit discriminator — never infer from label
  hasAudio: boolean;
  hasVideo: boolean;
  filesize?: number;   // bytes — exact or approx
  filesizeApprox?: number; // bytes — explicitly approximate from yt-dlp
  isApproximate?: boolean; // true if size is an estimate
  tbr?: number;        // bitrate in kbps
  fps?: number;        // frame rate
  vcodec?: string;     // raw video codec (e.g. "avc1.4D400C", "vp9", "av01...")
  acodec?: string;     // raw audio codec (e.g. "mp4a.40.2", "opus")
  codecName?: string;  // normalized codec family: "H.264", "VP9", "AV1", "AAC", "Opus"
  dynamicRange?: string; // e.g. "SDR", "HDR"
  isDrc?: boolean;     // true if dynamic range compression variant
}

export interface AnalyzeResponse {
  title: string;
  thumbnail?: string;
  duration?: number;   // seconds
  formats: FormatInfo[];
}

export interface DownloadRequest {
  url: string;
  formatId: string;
  streamType: StreamType;
  title?: string;  // used for Content-Disposition filename; sanitised server-side
}

export interface DownloadPrepareResponse {
  status: 'processing' | 'ready';
  jobId: string;
  token: string;
  downloadUrl: string;
  filename?: string;
  size?: number;
}

export interface DownloadStatusResponse {
  status: 'processing' | 'ready' | 'error';
  jobId: string;
  filename?: string;
  size?: number;
  downloadUrl?: string;
  progress?: {
    stage: 'downloading' | 'merging' | 'ready';
    percent?: number;
    speed?: string;
    eta?: string;
    detail?: string;
  };
  error?: { error: string; message: string };
}

// ── Structured error codes ────────────────────────────────────────────────────

export type AppErrorCode =
  | 'invalid_url'
  | 'unsupported_url'
  | 'unavailable_video'
  | 'upstream_rejected'
  | 'unsupported_format'
  | 'timeout'
  | 'internal_error'
  | 'rate_limit_exceeded'
  | 'concurrent_limit_exceeded';

export interface AppError {
  error: AppErrorCode;
  message: string;
  retryAfter?: number;
}
