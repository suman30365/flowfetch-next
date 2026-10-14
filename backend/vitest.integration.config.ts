import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Integration tests: real network calls, requires yt-dlp + ffmpeg on PATH
    include: ['src/tests/integration/**/*.test.ts'],
    testTimeout: 180_000,
  },
});
