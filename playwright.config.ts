import { defineConfig } from '@playwright/test';

/*
 * Desktop end-to-end tests against a production-like bundle. `build:e2e`
 * builds with --mode e2e (keeps the window.__game debug API, no IWER), and
 * `preview:e2e` serves it over HTTPS with the IWSDK dev certificate.
 * Headless Chromium renders WebGL through SwiftShader.
 */
const PORT = 4174;
const BASE_URL = `https://localhost:${PORT}/`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build:e2e && npm run preview:e2e',
    url: BASE_URL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
