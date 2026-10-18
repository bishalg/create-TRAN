import { defineBddConfig } from 'playwright-bdd';
import { defineConfig, devices } from '@playwright/test';

const testDir = defineBddConfig({
  features: 'features/*.feature',
  steps: 'steps/*.ts',
});

// `localhost:3000` is an allowed CORS origin of the API, so these tests also prove the
// browser -> Axum preflight (including X-Debug-Country) works for real.
const WEB_URL = 'http://localhost:3000';
const API_URL = 'http://127.0.0.1:3001';

export default defineConfig({
  testDir,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'cargo run -p api',
      cwd: '..',
      url: `${API_URL}/api/health`,
      env: { HOST: '127.0.0.1', PORT: '3001' },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter web dev --port 3000 --strictPort',
      cwd: '..',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
