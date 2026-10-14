// ── Mirrors backend/src/types.ts ──────────────────────────────────────────────

export type StreamType = 'video+audio' | 'video' | 'audio';

export interface FormatInfo {
  formatId: string;
  label: string;
  ext: string;
  quality: string;
  streamType: StreamType;
  hasAudio: boolean;
  hasVideo: boolean;
  filesize?: number;
  filesizeApprox?: number;
  isApproximate?: boolean;
  tbr?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  codecName?: string;
  dynamicRange?: string;
  isDrc?: boolean;
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

export interface AnalyzeResponse {
  title: string;
  thumbnail?: string;
  duration?: number;
  formats: FormatInfo[];
}

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

export interface ApiError {
  error: AppErrorCode;
  message: string;
  retryAfter?: number;
}
