import React, { useRef, useMemo, useState } from 'react';
import { FormatInfo } from './types';
import { groupAndDeduplicateFormats, getEstimatedFormatSize } from './utils/formatGrouping';

interface FormatSelectorProps {
  formats: FormatInfo[];
  selectedFormat: FormatInfo | null;
  onSelectFormat: (format: FormatInfo) => void;
  disabled?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNumericResolution(quality: string): number {
  const match = quality.match(/^(\d+)p$/i);
  return match ? parseInt(match[1], 10) : 0;
}

function formatResolutionLabel(quality: string): { main: string; badge?: string } {
  const num = getNumericResolution(quality);
  if (num >= 2160) return { main: `${num}p`, badge: '4K' };
  if (num >= 1440) return { main: `${num}p`, badge: '2K' };
  if (num === 1080) return { main: '1080p', badge: 'HD' };
  if (num === 720) return { main: '720p', badge: 'HD' };
  if (num > 0) return { main: `${num}p` };
  return { main: quality || 'Standard' };
}

function formatBitrate(tbr?: number, label?: string): string {
  if (typeof tbr === 'number' && tbr > 0) {
    if (tbr >= 1000) return `${(tbr / 1000).toFixed(1)} Mbps`;
    return `${Math.round(tbr)} kbps`;
  }
  if (label) {
    const match = label.match(/(\d+)\s*kbps/i);
    if (match) return `${match[1]} kbps`;
  }
  return '';
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

const VideoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
    <line x1="7" y1="2" x2="7" y2="22"/>
    <line x1="17" y1="2" x2="17" y2="22"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <line x1="2" y1="7" x2="7" y2="7"/>
    <line x1="2" y1="17" x2="7" y2="17"/>
    <line x1="17" y1="17" x2="22" y2="17"/>
    <line x1="17" y1="7" x2="22" y2="7"/>
  </svg>
);

const AudioIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
  </svg>
);

const BoltIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

// ── Component ─────────────────────────────────────────────────────────────────

export const FormatSelector: React.FC<FormatSelectorProps> = ({
  formats,
  selectedFormat,
  onSelectFormat,
  disabled = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showAdvancedVideos, setShowAdvancedVideos] = useState(false);
  const [showAdvancedAudio, setShowAdvancedAudio] = useState(false);

  // Group and deduplicate formats:
  // - recommendedVideos: exactly ONE recommended format per available resolution (highest compatibility)
  // - advancedVideos: alternate codecs (AV1, VP9), 60fps, HDR variants
  // - recommendedAudio: single recommended audio format (highest quality AAC/M4A)
  // - advancedAudio: alternate audio quality tiers and codecs
  const {
    recommendedVideos,
    advancedVideos,
    recommendedAudio,
    advancedAudio,
  } = useMemo(() => {
    return groupAndDeduplicateFormats(formats);
  }, [formats]);

  // If the user's selected format happens to be in advanced lists, auto-expand the corresponding section
  const isSelectedInAdvancedVideos = useMemo(() => {
    if (!selectedFormat) return false;
    return advancedVideos.some((f) => f.formatId === selectedFormat.formatId);
  }, [selectedFormat, advancedVideos]);

  const isSelectedInAdvancedAudio = useMemo(() => {
    if (!selectedFormat) return false;
    return advancedAudio.some((f) => f.formatId === selectedFormat.formatId);
  }, [selectedFormat, advancedAudio]);

  const isAdvancedVideosOpen = showAdvancedVideos || isSelectedInAdvancedVideos;
  const isAdvancedAudioOpen = showAdvancedAudio || isSelectedInAdvancedAudio;

  // Flattened order for keyboard navigation
  const allOrderedFormats = useMemo(() => {
    const list: FormatInfo[] = [...recommendedVideos];
    if (isAdvancedVideosOpen) {
      list.push(...advancedVideos);
    }
    if (recommendedAudio) {
      list.push(recommendedAudio);
    }
    if (isAdvancedAudioOpen) {
      list.push(...advancedAudio);
    }
    return list;
  }, [recommendedVideos, advancedVideos, recommendedAudio, advancedAudio, isAdvancedVideosOpen, isAdvancedAudioOpen]);

  const handleKeyDown = (e: React.KeyboardEvent, currentFormat: FormatInfo) => {
    if (disabled) return;
    const currentIndex = allOrderedFormats.findIndex((f) => f.formatId === currentFormat.formatId);
    if (currentIndex === -1) return;

    let targetIndex = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      targetIndex = (currentIndex + 1) % allOrderedFormats.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      targetIndex = (currentIndex - 1 + allOrderedFormats.length) % allOrderedFormats.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      targetIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      targetIndex = allOrderedFormats.length - 1;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectFormat(currentFormat);
      return;
    }

    if (targetIndex >= 0 && targetIndex < allOrderedFormats.length) {
      const nextFormat = allOrderedFormats[targetIndex];
      onSelectFormat(nextFormat);
      const el = containerRef.current?.querySelector<HTMLButtonElement>(`[data-format-id="${nextFormat.formatId}"]`);
      el?.focus();
    }
  };

  const renderVideoOption = (f: FormatInfo, isAdvanced = false) => {
    const isSelected = selectedFormat?.formatId === f.formatId;
    const res = formatResolutionLabel(f.quality);
    const estimatedSize = getEstimatedFormatSize(f, recommendedAudio);
    const bitrateStr = formatBitrate(f.tbr, f.label);
    const isVideoOnly = f.streamType === 'video';

    return (
      <button
        key={f.formatId}
        type="button"
        role="radio"
        aria-checked={isSelected}
        tabIndex={isSelected ? 0 : -1}
        data-format-id={f.formatId}
        disabled={disabled}
        className={`format-option format-option-video ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelectFormat(f)}
        onKeyDown={(e) => handleKeyDown(e, f)}
      >
        <div className="format-option-left">
          <div className="format-radio-indicator">
            {isSelected && <CheckIcon />}
          </div>
          <div className="format-res-box">
            <span className="format-res-main">{res.main}</span>
            {res.badge && <span className="format-res-badge">{res.badge}</span>}
          </div>
          <span className="format-ext-pill">{f.ext.toUpperCase()}</span>
          {f.codecName && (
            <span className="format-codec-pill">{f.codecName}</span>
          )}
          {isAdvanced && f.fps && f.fps >= 50 && (
            <span className="format-fps-pill">{f.fps}fps</span>
          )}
          {isAdvanced && f.dynamicRange && f.dynamicRange.toUpperCase().includes('HDR') && (
            <span className="format-hdr-pill">HDR</span>
          )}
          {isVideoOnly ? (
            <span className="format-badge format-badge-merge" title="Video-only stream — FlowFetch automatically merges high-quality audio">
              <BoltIcon /> Auto-merges audio
            </span>
          ) : (
            <span className="format-badge format-badge-combined" title="Combined stream — complete video and audio">
              ✓ Video + Audio
            </span>
          )}
        </div>

        <div className="format-option-right">
          {bitrateStr && (
            <span className="format-meta-bitrate">{bitrateStr}</span>
          )}
          <span
            className={`format-meta-size ${estimatedSize.isUnknown ? 'size-unknown' : ''}`}
            title={
              estimatedSize.breakdown
                ? `Estimated merged total: ${estimatedSize.label} (Video: ${estimatedSize.breakdown.videoLabel} + Audio: ${estimatedSize.breakdown.audioLabel})`
                : estimatedSize.isUnknown
                ? 'File size not provided in video metadata'
                : undefined
            }
          >
            {estimatedSize.label}
          </span>
        </div>
      </button>
    );
  };

  const renderAudioOption = (f: FormatInfo) => {
    const isSelected = selectedFormat?.formatId === f.formatId;
    const audioSize = getEstimatedFormatSize(f);
    const bitrateStr = formatBitrate(f.tbr, f.label);

    return (
      <button
        key={f.formatId}
        type="button"
        role="radio"
        aria-checked={isSelected}
        tabIndex={isSelected ? 0 : -1}
        data-format-id={f.formatId}
        disabled={disabled}
        className={`format-option format-option-audio ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelectFormat(f)}
        onKeyDown={(e) => handleKeyDown(e, f)}
      >
        <div className="format-option-left">
          <div className="format-radio-indicator">
            {isSelected && <CheckIcon />}
          </div>
          <div className="format-audio-pill">
            <AudioIcon />
            <span>{f.ext.toUpperCase()}</span>
          </div>
          {f.codecName && (
            <span className="format-codec-pill">{f.codecName}</span>
          )}
          <span className="format-badge format-badge-audio" title="Audio-only format — no video will be downloaded">
            Audio only
          </span>
        </div>

        <div className="format-option-right">
          {bitrateStr && (
            <span className="format-meta-bitrate">{bitrateStr}</span>
          )}
          <span
            className={`format-meta-size ${audioSize.isUnknown ? 'size-unknown' : ''}`}
            title={audioSize.isUnknown ? 'File size not provided in audio metadata' : undefined}
          >
            {audioSize.label}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="format-selector-container" ref={containerRef}>
      <label className="format-label" id="format-selector-heading">
        Choose Download Quality
      </label>

      <div
        className="format-selector-wrapper"
        role="radiogroup"
        aria-labelledby="format-selector-heading"
      >
        {/* ── VIDEO DOWNLOADS SECTION ─────────────────────────────────── */}
        {recommendedVideos.length > 0 && (
          <section className="format-section video-section" aria-label="Video downloads">
            <div className="format-section-header">
              <div className="format-section-icon video-icon-wrap">
                <VideoIcon />
              </div>
              <div className="format-section-titles">
                <h3 className="format-section-title">VIDEO DOWNLOADS</h3>
                <span className="format-section-subtitle">
                  One recommended format per resolution · Highest compatibility
                </span>
              </div>
            </div>

            <div className="format-options-grid">
              {recommendedVideos.map((f) => renderVideoOption(f, false))}
            </div>

            {/* ── ADVANCED VIDEO VARIANTS TOGGLE (Codecs, 60fps, HDR) ───── */}
            {advancedVideos.length > 0 && (
              <div className="advanced-section">
                <button
                  type="button"
                  className="advanced-toggle-btn"
                  onClick={() => setShowAdvancedVideos(!isAdvancedVideosOpen)}
                  aria-expanded={isAdvancedVideosOpen}
                >
                  <SettingsIcon />
                  <span>
                    {isAdvancedVideosOpen ? 'Hide' : 'Show'} Advanced video variants ({advancedVideos.length})
                  </span>
                  <span className="advanced-hint">Alternate codecs & frame rates</span>
                </button>

                {isAdvancedVideosOpen && (
                  <div className="format-options-grid advanced-grid" style={{ marginTop: '0.6rem' }}>
                    {advancedVideos.map((f) => renderVideoOption(f, true))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── FULL-WIDTH HORIZONTAL DIVIDER ────────────────────────────── */}
        {recommendedVideos.length > 0 && (recommendedAudio || advancedAudio.length > 0) && (
          <div className="format-sections-divider" role="separator" aria-label="Audio formats divider" />
        )}

        {/* ── AUDIO ONLY SECTION ───────────────────────────────────────── */}
        {(recommendedAudio || advancedAudio.length > 0) && (
          <section className="format-section audio-section" aria-label="Audio only downloads">
            <div className="format-section-header">
              <div className="format-section-icon audio-icon-wrap">
                <AudioIcon />
              </div>
              <div className="format-section-titles">
                <h3 className="format-section-title">AUDIO ONLY</h3>
                <span className="format-section-subtitle">
                  Recommended audio track · Does not contain video
                </span>
              </div>
            </div>

            {recommendedAudio && (
              <div className="format-options-grid">
                {renderAudioOption(recommendedAudio)}
              </div>
            )}

            {/* ── ADVANCED AUDIO OPTIONS TOGGLE ─────────────────────────── */}
            {advancedAudio.length > 0 && (
              <div className="advanced-section">
                <button
                  type="button"
                  className="advanced-toggle-btn"
                  onClick={() => setShowAdvancedAudio(!isAdvancedAudioOpen)}
                  aria-expanded={isAdvancedAudioOpen}
                >
                  <SettingsIcon />
                  <span>
                    {isAdvancedAudioOpen ? 'Hide' : 'Show'} Advanced audio options ({advancedAudio.length})
                  </span>
                  <span className="advanced-hint">Alternate codecs & quality tiers</span>
                </button>

                {isAdvancedAudioOpen && (
                  <div className="format-options-grid advanced-grid advanced-grid-audio" style={{ marginTop: '0.6rem' }}>
                    {advancedAudio.map(renderAudioOption)}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {/* ── HELPFUL EXPLANATION BENEATH SELECTOR ───────────────────────── */}
      {selectedFormat && (
        <div
          className={`format-selection-card ${
            selectedFormat.streamType === 'audio' ? 'card-audio' : 'card-video'
          }`}
          role="status"
          aria-live="polite"
        >
          {selectedFormat.streamType === 'video' && (() => {
            const selectedSize = getEstimatedFormatSize(selectedFormat, recommendedAudio);
            return (
              <>
                <div className="selection-card-icon">⚡</div>
                <div className="selection-card-text">
                  <div>
                    <strong>{selectedFormat.quality} {selectedFormat.ext.toUpperCase()} {selectedFormat.codecName ? `(${selectedFormat.codecName})` : ''}</strong> is a high-resolution video stream.
                    FlowFetch will automatically download and merge the best matching audio track using FFmpeg into a complete MP4 file.
                  </div>
                  {selectedSize.breakdown ? (
                    <div className="selection-size-breakdown">
                      Estimated file size: <strong>{selectedSize.label}</strong> (Video: {selectedSize.breakdown.videoLabel} + Audio: {selectedSize.breakdown.audioLabel})
                    </div>
                  ) : !selectedSize.isUnknown ? (
                    <div className="selection-size-breakdown">
                      Estimated file size: <strong>{selectedSize.label}</strong>
                    </div>
                  ) : null}
                </div>
              </>
            );
          })()}

          {selectedFormat.streamType === 'video+audio' && (() => {
            const selectedSize = getEstimatedFormatSize(selectedFormat);
            return (
              <>
                <div className="selection-card-icon">✓</div>
                <div className="selection-card-text">
                  <div>
                    <strong>{selectedFormat.quality} {selectedFormat.ext.toUpperCase()}</strong> includes both video and audio.
                    It will be downloaded directly without re-encoding.
                  </div>
                  {!selectedSize.isUnknown && (
                    <div className="selection-size-breakdown">
                      File size: <strong>{selectedSize.label}</strong>
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {selectedFormat.streamType === 'audio' && (() => {
            const selectedSize = getEstimatedFormatSize(selectedFormat);
            return (
              <>
                <div className="selection-card-icon">🎵</div>
                <div className="selection-card-text">
                  <div>
                    <strong>{selectedFormat.ext.toUpperCase()} Audio ({selectedFormat.codecName || ''} {formatBitrate(selectedFormat.tbr, selectedFormat.label) || 'standard'})</strong> selected.
                    This download contains <em>audio only</em> and does not include video.
                  </div>
                  {!selectedSize.isUnknown && (
                    <div className="selection-size-breakdown">
                      Audio file size: <strong>{selectedSize.label}</strong>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};
