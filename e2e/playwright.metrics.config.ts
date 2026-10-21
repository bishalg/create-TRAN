import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshots, performance and release smoke tests (ADR-0031), against the production web build — what users get —
 * not the dev server. Kept apart from the Gherkin suite: these measure how the app looks and how
 * fast it is, not what it does.
 *
 * Screenshot references live in `.screenshots/` (gitignored, per machine). A missing reference
 * is recorded on the first run; `pnpm visual:update` re-records after an intended change.
 */
// 127.0.0.1, not `localhost`: another project's dev server on [::1]:3000 must never be measured.
const WEB_URL = 'http://127.0.0.1:3000';
const API_URL = 'http://127.0.0.1:3001';

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  updateSnapshots: 'missing',
  snapshotPathTemplate: '.screenshots/{projectName}/{platform}/{arg}{ext}',
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 } },
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'visual', testDir: 'visual', use: { ...devices['Desktop Chrome'] } },
    // One worker: parallel runs would compete for the CPU and skew every timing.
    { name: 'perf', testDir: 'perf', fullyParallel: false, use: { ...devices['Desktop Chrome'] } },
    // Release builds start (REQ-PERF-008); serial, since the native checks share one device.
    {
      name: 'smoke',
      testDir: 'smoke',
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  workers: process.env.PERF ? 1 : undefined,
  webServer: [
    {
      command: 'cargo run -p api',
      cwd: '..',
      url: `${API_URL}/api/health`,
      env: { HOST: '127.0.0.1', PORT: '3001', APP_ENV: 'test' },
      // Never reuse: a dev server or another project's server would be measured instead.
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command:
        'pnpm --filter web build && pnpm --filter web serve --host 127.0.0.1 --port 3000 --strictPort',
      cwd: '..',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
