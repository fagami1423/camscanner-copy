import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const Y4M = resolve('tests/fixtures/generated/page.y4m');

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/globalSetup.ts',
  // OpenCV + Tesseract initialisation and OCR are slow.
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${Y4M}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
