/**
 * LIVE INTEGRATION TESTS
 *
 * These tests make real network requests to YouTube via yt-dlp.
 * They are excluded from `npm test` by default (see vitest.config.ts).
 *
 * Prerequisites:
 *   - yt-dlp installed and on PATH (or YTDLP_PATH set)
 *   - ffmpeg installed and on PATH (or FFMPEG_PATH set)  ← needed for download test
 *   - Internet access to YouTube
 *
 * Run with:
 *   npm run test:integration
 *
 * Test video: https://www.youtube.com/watch?v=jNQXAC9IVRw
 * ("Me at the zoo" — first YouTube video ever uploaded, ~18 s, public)
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import request from 'supertest';
import app from '../../app';
import { analyzeVideo, downloadFormat } from '../../services/ytdlp';
import { validateYouTubeUrl } from '../../utils/urlValidator';

const TEST_VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const ANALYZE_TIMEOUT = 60_000;
const DOWNLOAD_TIMEOUT = 120_000;

const downloadedFiles: string[] = [];

afterEach(() => {
  // Clean up any files created during download tests
  for (const f of downloadedFiles) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
  downloadedFiles.length = 0;
});

describe('[LIVE] analyzeVideo', () => {
  it('returns real metadata for a known public video', async () => {
    const url = validateYouTubeUrl(TEST_VIDEO_URL);
    const meta = await analyzeVideo(url, ANALYZE_TIMEOUT);

    expect(typeof meta.title).toBe('string');
    expect(meta.title.length).toBeGreaterThan(0);
    expect(Array.isArray(meta.formats)).toBe(true);
    expect(meta.formats.length).toBeGreaterThan(0);

    // Every format must carry the required fields
    for (const f of meta.formats) {
      expect(typeof f.formatId).toBe('string');
      expect(f.formatId.length).toBeGreaterThan(0);
      expect(typeof f.ext).toBe('string');
      expect(['video+audio', 'video', 'audio']).toContain(f.streamType);
      // streamType must match hasVideo / hasAudio flags
      if (f.streamType === 'video+audio') {
        expect(f.hasVideo).toBe(true);
        expect(f.hasAudio).toBe(true);
      } else if (f.streamType === 'video') {
        expect(f.hasVideo).toBe(true);
        expect(f.hasAudio).toBe(false);
      } else {
        expect(f.hasVideo).toBe(false);
        expect(f.hasAudio).toBe(true);
      }
    }

    // First format should be combined or video (never audio-only at top of list)
    expect(meta.formats[0].streamType).not.toBe('audio');

    console.log(`[LIVE] title: ${meta.title}`);
    console.log(`[LIVE] total formats: ${meta.formats.length}`);
    console.log(`[LIVE] combined: ${meta.formats.filter(f => f.streamType === 'video+audio').length}`);
    console.log(`[LIVE] video-only: ${meta.formats.filter(f => f.streamType === 'video').length}`);
    console.log(`[LIVE] audio-only: ${meta.formats.filter(f => f.streamType === 'audio').length}`);
    console.log(`[LIVE] first format: ${JSON.stringify(meta.formats[0])}`);
  }, ANALYZE_TIMEOUT);

  it('rejects a clearly invalid video ID', async () => {
    await expect(
      analyzeVideo('https://www.youtube.com/watch?v=XXXXXXXXXXX', ANALYZE_TIMEOUT),
    ).rejects.toThrow();
  }, ANALYZE_TIMEOUT);
});

describe('[LIVE] downloadFormat — combined stream', () => {
  it('downloads a small public video, file is non-zero and exists', async () => {
    const url = validateYouTubeUrl(TEST_VIDEO_URL);

    // First analyze to find a real combined or video-only format
    const meta = await analyzeVideo(url, ANALYZE_TIMEOUT);
    const combinedFmt = meta.formats.find(f => f.streamType === 'video+audio');
    const fmt = combinedFmt ?? meta.formats[0];

    console.log(`[LIVE] downloading format: ${fmt.formatId} (${fmt.label})`);

    const result = await downloadFormat(url, fmt.formatId, fmt.streamType, DOWNLOAD_TIMEOUT);
    downloadedFiles.push(result.filePath);

    // File must exist and be non-zero
    expect(fs.existsSync(result.filePath)).toBe(true);
    const stat = fs.statSync(result.filePath);
    expect(stat.size).toBeGreaterThan(0);

    // Extension must be a known video/audio extension
    expect(['mp4', 'webm', 'mkv', 'm4a', 'mp3', 'ogg', 'opus']).toContain(result.ext);

    console.log(`[LIVE] downloaded: ${result.filePath} (${(stat.size / 1024).toFixed(1)} KB)`);
  }, DOWNLOAD_TIMEOUT);
});

describe('[LIVE] POST /api/download & GET /api/download/file — two-step download flow', () => {
  it('prepares merged video job then streams file with Content-Disposition attachment', async () => {
    const url = validateYouTubeUrl(TEST_VIDEO_URL);
    const meta = await analyzeVideo(url, ANALYZE_TIMEOUT);
    const fmt = meta.formats.find((f) => f.streamType === 'video+audio') ?? meta.formats[0];

    // Step 1: POST prepare job
    const prepareRes = await request(app)
      .post('/api/download')
      .send({
        url,
        formatId: fmt.formatId,
        streamType: fmt.streamType,
        title: meta.title,
      });

    expect(prepareRes.status).toBe(200);
    expect(prepareRes.body.status).toBe('processing');
    expect(typeof prepareRes.body.jobId).toBe('string');
    expect(typeof prepareRes.body.downloadUrl).toBe('string');
    console.log(`[LIVE API] Job reserved: ${prepareRes.body.jobId}, downloadUrl: ${prepareRes.body.downloadUrl}`);

    // Step 2: GET stream file (pending GET or ready stream)
    const streamRes = await request(app)
      .get(prepareRes.body.downloadUrl)
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk: Buffer) => data.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(data)));
      });

    expect(streamRes.status).toBe(200);
    expect(streamRes.headers['content-disposition']).toMatch(/attachment;\s*filename=/);
    expect(streamRes.headers['content-type']).toMatch(/video\/|application\/octet-stream/);
    expect(Buffer.isBuffer(streamRes.body)).toBe(true);
    const contentLength = Number(streamRes.headers['content-length']);
    expect(contentLength).toBeGreaterThan(0);
    expect((streamRes.body as Buffer).length).toBe(contentLength);
    console.log(`[LIVE API] HTTP 200 streamed with ${(streamRes.body as Buffer).length} bytes`);
  }, DOWNLOAD_TIMEOUT);
});

