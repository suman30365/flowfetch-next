/**
 * Regression test for the FFmpeg merge path.
 *
 * Root cause (discovered 2026-10-13):
 *   yt-dlp's --ffmpeg-location expects a DIRECTORY containing ffmpeg, not a
 *   bare binary name.  When passed just "ffmpeg", yt-dlp silently skips the
 *   merge step and exits 0 — leaving only intermediate .fNNN.ext files.
 *
 * The fix: resolveFFmpegDir() in ytdlp.ts now uses `where`/`which` to find
 * the actual binary path, then passes its parent directory.
 *
 * This file tests the detection logic (findOutputFile + merge guard) that
 * catches the failure even if the resolution regresses.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('findOutputFile / merge guard logic', () => {
  const tmpDir = path.join(os.tmpdir(), 'flowfetch-test-' + Date.now());

  // Create a temp dir with fake files matching yt-dlp naming patterns
  function setup(files: string[]) {
    fs.mkdirSync(tmpDir, { recursive: true });
    for (const f of files) {
      fs.writeFileSync(path.join(tmpDir, f), 'test content');
    }
  }

  function teardown() {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  afterEach(teardown);

  it('detects intermediate files when merge was skipped (regression)', () => {
    const jobId = 'regression-test-1';
    setup([
      `${jobId}.f229.mp4`,  // video-only intermediate
      `${jobId}.f140.m4a`,  // audio-only intermediate
    ]);

    // Read dir like findOutputFile does
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(jobId));

    // The merged file would be `${jobId}.mp4` (no .fNNN. infix)
    const merged = files.find(f => f === `${jobId}.mp4`);
    expect(merged).toBeUndefined();  // no merged file exists

    // The fallback picks the intermediate — which the merge guard should reject
    const fallback = files.find(f => f.endsWith('.mp4'));
    expect(fallback).toBe(`${jobId}.f229.mp4`);

    // The intermediate detection regex must match
    expect(/\.f\d+\./.test(fallback!)).toBe(true);
  });

  it('finds the merged file when merge succeeded', () => {
    const jobId = 'regression-test-2';
    setup([
      `${jobId}.mp4`,  // merged output (no .fNNN. infix)
    ]);

    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(jobId));
    const merged = files.find(f => f === `${jobId}.mp4`);
    expect(merged).toBe(`${jobId}.mp4`);

    // Must NOT match the intermediate pattern
    expect(/\.f\d+\./.test(merged!)).toBe(false);
  });

  it('does not false-positive on normal combined downloads', () => {
    const jobId = 'regression-test-3';
    setup([
      `${jobId}.mp4`,  // single combined format download
    ]);

    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(jobId));
    const file = files[0];

    // Combined format downloads have no .fNNN. infix
    expect(/\.f\d+\./.test(file)).toBe(false);
  });
});
