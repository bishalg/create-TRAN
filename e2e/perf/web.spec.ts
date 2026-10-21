// Verifies: REQ-PERF-004
/**
 * Web performance of the production build, as numbers that can be tracked over time (ADR-0031).
 *
 * - Lighthouse (desktop preset) scores and lab metrics. Its throttling is simulated, so a score
 *   moves when the page changes, not when the machine is busy.
 * - Navigation Timing from a real load: what this machine actually waited for. Judged only
 *   against earlier runs on the same machine.
 *
 * Every value is the median of `PERF_RUNS` loads (default 5). The result goes to
 * `.metrics/runs/web.json` (gitignored); `pnpm metrics` judges it and `--record` commits it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import lighthouse, { desktopConfig } from 'lighthouse';

const RUNS = Number(process.env.PERF_RUNS ?? 5);
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

type Metric = { value: number; unit: 'score' | 'ms' | 'ratio'; kind: 'score' | 'timing' };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** A port nobody is listening on, for the browser's DevTools endpoint. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject()
      );
    });
  });

/** Lighthouse category scores (0–100) and lab metrics for one load. */
const LIGHTHOUSE: Record<string, (lhr: LighthouseResult) => number> = {
  'web.lighthouse.performance': (lhr) => lhr.categories.performance!.score! * 100,
  'web.lighthouse.accessibility': (lhr) => lhr.categories.accessibility!.score! * 100,
  'web.lighthouse.best-practices': (lhr) => lhr.categories['best-practices']!.score! * 100,
  'web.lighthouse.seo': (lhr) => lhr.categories.seo!.score! * 100,
  'web.fcp': (lhr) => lhr.audits['first-contentful-paint']!.numericValue!,
  'web.lcp': (lhr) => lhr.audits['largest-contentful-paint']!.numericValue!,
  'web.tbt': (lhr) => lhr.audits['total-blocking-time']!.numericValue!,
  'web.cls': (lhr) => lhr.audits['cumulative-layout-shift']!.numericValue!,
  'web.speed-index': (lhr) => lhr.audits['speed-index']!.numericValue!,
};
type LighthouseResult = NonNullable<Awaited<ReturnType<typeof lighthouse>>>['lhr'];

const unitOf = (id: string): Metric => {
  if (id.startsWith('web.lighthouse.')) return { value: 0, unit: 'score', kind: 'score' };
  // CLS is unitless and simulated, like the scores: it does not depend on the machine.
  if (id === 'web.cls') return { value: 0, unit: 'ratio', kind: 'score' };
  return { value: 0, unit: 'ms', kind: 'timing' };
};

test('web performance medians', async ({ baseURL }) => {
  test.setTimeout(RUNS * 60_000);
  const samples: Record<string, number[]> = {};
  const add = (id: string, value: number) => (samples[id] ??= []).push(value);

  const port = await freePort();
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  try {
    for (let run = 0; run < RUNS; run++) {
      const result = await lighthouse(
        baseURL!,
        { port, output: 'json', logLevel: 'error' },
        desktopConfig
      );
      const lhr = result!.lhr;
      expect(lhr.runtimeError, lhr.runtimeError?.message).toBeUndefined();
      for (const [id, read] of Object.entries(LIGHTHOUSE)) add(id, read(lhr));

      // A cold, unthrottled load in a fresh context: the time this machine really took.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(baseURL!, { waitUntil: 'load' });
      await expect(page.getByText(/API (online|offline)/)).toBeVisible();
      const nav = await page.evaluate(() => {
        const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        return {
          ttfb: entry!.responseStart,
          domContentLoaded: entry!.domContentLoadedEventEnd,
          load: entry!.loadEventEnd,
        };
      });
      add('web.ttfb', nav.ttfb);
      add('web.dom-content-loaded', nav.domContentLoaded);
      add('web.load', nav.load);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const metrics: Record<string, Metric> = {};
  for (const [id, values] of Object.entries(samples)) {
    metrics[id] = { ...unitOf(id), value: Math.round(median(values) * 1000) / 1000 };
  }
  const out = path.join(ROOT, '.metrics/runs');
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, 'web.json'),
    `${JSON.stringify({ collector: 'web', runs: RUNS, metrics }, null, 2)}\n`
  );
  // A score of 0 means Lighthouse could not measure the page at all.
  expect(metrics['web.lighthouse.performance']!.value).toBeGreaterThan(0);
});
