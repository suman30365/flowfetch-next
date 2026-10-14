import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Default run: unit tests only (no network required)
    include: ['src/tests/unit/**/*.test.ts'],
  },
});
