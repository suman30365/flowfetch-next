import { useState, useCallback, useRef } from 'react';
import { analyzeUrl, downloadVideo } from './api';
import { AnalyzeResponse, FormatInfo, ApiError } from './types';
import { FormatSelector } from './FormatSelector';
import { groupAndDeduplicateFormats } from './utils/formatGrouping';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function friendlyError(err: ApiError): string {
  if (err.error === 'rate_limit_exceeded') {
    if (typeof err.retryAfter === 'number' && err.retryAfter > 0) {
      return `Too many requests — please wait ${err.retryAfter}s before trying again.`;
    }
    return 'Too many requests — please wait a moment and try again.';
  }

  // If the server provided a specific informative error message, display it
  if (
    err.message &&
    !err.message.startsWith('HTTP ') &&
    err.message !== 'An error occurred' &&
    err.message !== 'An internal error occurred. Check server logs.'
  ) {
    return err.message;
  }

  const map: Record<string, string> = {
    invalid_url:              'The URL is invalid. Please paste a full YouTube URL.',
    unsupported_url:          'Only YouTube video URLs are supported right now.',
    unavailable_video:        'This video is unavailable or private.',
    upstream_rejected:        'YouTube rejected the request (the video may be age-restricted or geo-blocked).',
    unsupported_format:       'The selected format is no longer available.',
    timeout:                  'The request timed out. Check your connection and try again.',
    internal_error:           'A server error occurred. Please try again.',
    rate_limit_exceeded:      'Too many requests — please wait a moment and try again.',
    concurrent_limit_exceeded:'The server is busy. Please try again shortly.',
  };
  return map[err.error] ?? err.message ?? 'An unknown error occurred.';
}

// ── Icons (inline SVG) ─────────────────────────────────────────────────────────

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

const LogoIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>
);

const AlertIcon = ({ type }: { type: 'error' | 'info' | 'success' }) => {
  const icons = {
    error:   '✕',
    info:    'ℹ',
    success: '✓',
  };
  return <span aria-hidden="true">{icons[type]}</span>;
};

const VideoPlaceholderIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .3 }}>
    <polygon points="23 7 16 12 23 17 23 7"/>
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>
);

// ── Main App ──────────────────────────────────────────────────────────────────

type AppState = 'idle' | 'analyzing' | 'ready' | 'downloading' | 'done';

export default function App() {
  const [url, setUrl] = useState('');
  const [appState, setAppState] = useState<AppState>('idle');
  const [meta, setMeta] = useState<AnalyzeResponse | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<FormatInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [prepStatus, setPrepStatus] = useState<string | null>(null);
  const isDownloadingRef = useRef(false);
  const isAnalyzingRef = useRef(false);

  const clearMessages = () => { setError(null); setSuccessMsg(null); };

  // ── Analyze ─────────────────────────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (isAnalyzingRef.current) return;
    const trimmed = url.trim();
    if (!trimmed) {
      clearMessages();
      setError('Please paste a YouTube URL first.');
      return;
    }

    isAnalyzingRef.current = true;
    clearMessages();
    setMeta(null);
    setSelectedFormat(null);
    setAppState('analyzing');

    try {
      const data = await analyzeUrl(trimmed);
      setMeta(data);
      if (data.formats.length > 0) {
        // Set top recommended format (highest compatibility resolution) as default
        const { recommendedVideos, recommendedAudio } = groupAndDeduplicateFormats(data.formats);
        const defaultFmt = recommendedVideos[0] ?? recommendedAudio ?? data.formats[0];
        setSelectedFormat(defaultFmt);
      }
      setAppState('ready');
    } catch (e) {
      const err = e as ApiError;
      setError(friendlyError(err));
      setAppState('idle');
    } finally {
      isAnalyzingRef.current = false;
    }
  }, [url]);

  // ── Download ─────────────────────────────────────────────────────────────────

  const isBusy = appState === 'analyzing' || appState === 'downloading';

  const handleDownload = useCallback(async () => {
    if (!meta || !selectedFormat || isBusy || isDownloadingRef.current) return;
    isDownloadingRef.current = true;
    clearMessages();
    setAppState('downloading');
    setPrepStatus('Initiating download in your browser...');

    try {
      const res = await downloadVideo(
        url.trim(),
        selectedFormat.formatId,
        selectedFormat.streamType,
        meta.title,
        (msg) => setPrepStatus(msg),
      );
      setSuccessMsg(`Download complete: "${res.filename}"! Check your browser's Downloads list.`);
      setAppState('ready');
    } catch (e) {
      const err = e as ApiError;
      setError(friendlyError(err));
      setAppState('ready');
    } finally {
      isDownloadingRef.current = false;
      setPrepStatus(null);
    }
  }, [meta, selectedFormat, url, isBusy]);

  const handleReset = () => {
    setUrl('');
    setMeta(null);
    setSelectedFormat(null);
    setError(null);
    setSuccessMsg(null);
    setPrepStatus(null);
    isDownloadingRef.current = false;
    isAnalyzingRef.current = false;
    setAppState('idle');
  };

  return (
    <div className="page" role="main">
      <div className="card">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="header">
          <div className="logo" aria-label="FlowFetch logo">
            <div className="logo-icon"><LogoIcon /></div>
            <span className="logo-text">FlowFetch</span>
          </div>
          <p className="header-sub">
            Paste a YouTube URL · Pick a quality · Download
          </p>
        </header>

        {/* ── URL input ──────────────────────────────────────────────────── */}
        <div className="input-group">
          <label htmlFor="url-input" className="sr-only">YouTube URL</label>
          <input
            id="url-input"
            type="url"
            className="url-input"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => { setUrl(e.target.value); clearMessages(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isBusy && !isAnalyzingRef.current) handleAnalyze(); }}
            disabled={isBusy}
            aria-label="YouTube video URL"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            id="analyze-btn"
            className="btn btn-primary"
            onClick={handleAnalyze}
            disabled={isBusy || isAnalyzingRef.current || !url.trim()}
            aria-busy={appState === 'analyzing'}
          >
            {appState === 'analyzing' ? (
              <><div className="spinner" /><span>Analyzing…</span></>
            ) : (
              <><SearchIcon /><span>Analyze</span></>
            )}
          </button>
        </div>

        {/* ── Progress bar ───────────────────────────────────────────────── */}
        {isBusy && (
          <div className="progress-wrap" role="progressbar" aria-label={appState === 'analyzing' ? 'Analyzing…' : 'Downloading…'}>
            <div className="progress-bar" />
          </div>
        )}

        {/* ── Status messages ────────────────────────────────────────────── */}
        {appState === 'downloading' && prepStatus && (
          <div className="status-bar info" role="status" aria-live="polite">
            <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 600 }}>{prepStatus}</span>
              <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>
                Browser download connection is pending and will transfer once media preparation completes.
              </span>
            </div>
          </div>
        )}
        {error && (
          <div className="status-bar error" role="alert">
            <AlertIcon type="error" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="status-bar success" role="status">
            <AlertIcon type="success" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* ── Video metadata card ────────────────────────────────────────── */}
        {meta && (
          <>
            <div className="video-meta">
              <div className="video-thumb-wrap">
                {meta.thumbnail ? (
                  <img
                    className="video-thumb"
                    src={meta.thumbnail}
                    alt={`Thumbnail for ${meta.title}`}
                    loading="lazy"
                  />
                ) : (
                  <div className="video-thumb-placeholder" aria-hidden="true">
                    <VideoPlaceholderIcon />
                  </div>
                )}
              </div>
              <div className="video-info">
                <p className="video-title" title={meta.title}>{meta.title}</p>
                {meta.duration !== undefined && (
                  <p className="video-duration" aria-label={`Duration: ${formatDuration(meta.duration)}`}>
                    ⏱ {formatDuration(meta.duration)}
                  </p>
                )}
              </div>
            </div>

            {/* ── Format selector ──────────────────────────────────────── */}
            {meta.formats.length > 0 ? (
              <>
                <FormatSelector
                  formats={meta.formats}
                  selectedFormat={selectedFormat}
                  onSelectFormat={(f) => {
                    setSelectedFormat(f);
                    clearMessages();
                  }}
                  disabled={isBusy}
                />

                <button
                  id="download-btn"
                  className="btn btn-success"
                  onClick={handleDownload}
                  disabled={isBusy || !selectedFormat}
                  aria-busy={appState === 'downloading'}
                >
                  {appState === 'downloading' ? (
                    <><div className="spinner" /><span>Downloading…</span></>
                  ) : (
                    <><DownloadIcon /><span>Download</span></>
                  )}
                </button>
              </>
            ) : (
              <div className="status-bar info">
                <AlertIcon type="info" />
                <span>No downloadable formats found for this video.</span>
              </div>
            )}

            <div className="divider" />
            <button
              id="reset-btn"
              className="btn btn-ghost"
              onClick={handleReset}
              disabled={isBusy}
            >
              ← Try another URL
            </button>
          </>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="footer">
        <p>FlowFetch Next · YouTube only · For content you are authorized to download</p>
        <p>Respects copyright and platform terms of service</p>
      </footer>
    </div>
  );
}
