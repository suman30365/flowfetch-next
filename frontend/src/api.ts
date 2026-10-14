import { AnalyzeResponse, ApiError, StreamType, DownloadPrepareResponse, DownloadStatusResponse } from './types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const BASE = API_BASE_URL ? `${API_BASE_URL}/api` : '/api';

async function parseError(res: Response): Promise<ApiError> {
  const retryAfterHeader = res.headers.get('Retry-After');
  const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
  try {
    const json = (await res.json()) as ApiError;
    return {
      ...json,
      retryAfter: retryAfter ?? (json as any)?.retryAfter,
    };
  } catch {
    return {
      error: res.status === 429 ? 'rate_limit_exceeded' : 'internal_error',
      message: res.status === 429 ? 'Too many requests — please slow down.' : `HTTP ${res.status}`,
      retryAfter,
    };
  }
}

// ── Analyze ───────────────────────────────────────────────────────────────────

export async function analyzeUrl(url: string): Promise<AnalyzeResponse> {
  const res = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const err = await parseError(res);
    throw err;
  }

  return res.json() as Promise<AnalyzeResponse>;
}

// ── Download ──────────────────────────────────────────────────────────────────

/**
 * Immediate browser-native download flow:
 * 1. POSTs download request to create/reserve job, returning immediately (<10ms).
 * 2. Immediately triggers native browser download on the stable download URL.
 * 3. The browser keeps the GET request pending while yt-dlp & FFmpeg process in background.
 * 4. Polling checks preparation status to honestly update the UI.
 * 5. When processing completes, file streams directly to disk through the pending connection.
 */
export async function downloadVideo(
  url: string,
  formatId: string,
  streamType: StreamType,
  title: string,
  onStatusUpdate?: (statusMessage: string) => void,
  abortSignal?: AbortSignal,
): Promise<{ filename: string; size?: number }> {
  // Step 1: POST to reserve job (returns immediately with jobId and stable downloadUrl)
  const res = await fetch(`${BASE}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formatId, streamType, title }),
    signal: abortSignal,
  });

  if (!res.ok) {
    const err = await parseError(res);
    throw err;
  }

  const prep = (await res.json()) as DownloadPrepareResponse;
  const targetFilename = prep.filename ?? 'download.mp4';

  onStatusUpdate?.('Download initiated in browser. Connecting download stream...');

  // Step 2: Immediately initiate the single native browser download request
  const anchor = document.createElement('a');
  anchor.href = prep.downloadUrl.startsWith('http')
    ? prep.downloadUrl
    : `${API_BASE_URL}${prep.downloadUrl}`;
  anchor.download = targetFilename;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    try {
      if (anchor.parentNode) {
        anchor.parentNode.removeChild(anchor);
      }
    } catch {
      // Ignore
    }
  }, 1000);

  // If already ready (e.g. deduplicated cached job), finish immediately
  if (prep.status === 'ready') {
    onStatusUpdate?.('Download started!');
    return { filename: targetFilename, size: prep.size };
  }

  // Step 3: Monitor preparation status while browser holds pending GET connection
  let attempts = 0;
  const maxAttempts = 300; // 5 minutes max polling (1s interval)

  while (attempts < maxAttempts) {
    if (abortSignal?.aborted) {
      try {
        await fetch(`${BASE}/download/cancel/${prep.jobId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: prep.token }),
        });
      } catch {
        // Best effort
      }
      throw { error: 'cancelled', message: 'Download was cancelled.' };
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;

    try {
      const statusRes = await fetch(`${BASE}/download/status/${prep.jobId}?token=${prep.token}`);
      if (!statusRes.ok) {
        if (statusRes.status === 404 || statusRes.status === 410) {
          // Job was completed or removed
          break;
        }
        const err = await parseError(statusRes);
        throw err;
      }

      const statusData = (await statusRes.json()) as DownloadStatusResponse;

      if (statusData.status === 'error') {
        const errObj = statusData.error ?? { error: 'internal_error', message: 'Download failed.' };
        throw errObj;
      }

      if (statusData.status === 'ready') {
        onStatusUpdate?.('Media preparation complete! Streaming file to Downloads.');
        return {
          filename: statusData.filename ?? targetFilename,
          size: statusData.size,
        };
      }

      // Still processing
      if (statusData.progress?.detail) {
        onStatusUpdate?.(statusData.progress.detail);
      } else if (attempts < 5) {
        onStatusUpdate?.('Preparing media: downloading video stream...');
      } else if (attempts < 15) {
        onStatusUpdate?.('Downloading streams & merging with FFmpeg...');
      } else {
        onStatusUpdate?.(`Processing media in progress (${attempts}s)... Browser is waiting for stream.`);
      }
    } catch (e) {
      if ((e as ApiError).error) {
        throw e;
      }
      // Transient polling network glitch — continue loop
    }
  }

  return { filename: targetFilename };
}

export async function cancelDownload(jobId: string, token: string): Promise<void> {
  try {
    await fetch(`${BASE}/download/cancel/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    // Ignore
  }
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
