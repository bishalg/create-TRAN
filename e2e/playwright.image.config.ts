import { defineConfig } from '@playwright/test';

/**
 * The API image smoke test (`pnpm deploy:smoke`, spec 032 REQ-DEP-007). Its own config: no web
 * server, no `cargo run`, no browser; it builds the release image itself, so the timeout covers a
 * cold Rust build.
 */
export default defineConfig({
  testDir: 'smoke',
  testMatch: 'image.spec.ts',
  timeout: 40 * 60_000,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
});
