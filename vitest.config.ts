import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/cv/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/cv/globalSetup.ts'],
    // OpenCV WASM init and full-resolution image work are slow.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
