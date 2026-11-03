import { defineConfig } from '@playwright/test';

// Tests draaien tegen de productie-build (vite preview op 4173): geen HMR,
// geen dep-optimalisatie-reloads, dezelfde bundel als de PWA.
export default defineConfig({
  testDir: 'tests',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    trace: 'off',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--use-file-for-fake-video-capture=' + process.env.MK8_FAKE_VIDEO,
      ].filter((a) => !a.endsWith('undefined')),
    },
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/parity.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
