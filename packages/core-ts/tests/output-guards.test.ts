// Verifies: REQ-PERF-001
/**
 * Generated output never reaches git (ADR-0031): screenshots, reports and logs are produced per
 * machine; only the text metrics report in `docs/reports/` is committed.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** One sample file inside every folder a tool writes into. */
const OUTPUT_SAMPLES = [
  'coverage/lcov.info',
  'apps/web/coverage/index.html',
  'packages/core-ts/reports/mutation/mutation.html',
  'packages/core-ts/.stryker-tmp/sandbox/x.ts',
  'mutants.out/outcomes.json',
  'e2e/test-results/run/trace.zip',
  'e2e/playwright-report/index.html',
  'e2e/.features-gen/features/a.spec.js',
  'e2e/.screenshots/visual/home-light-en.png',
  'apps/android/app/.screenshots/home-light-en.png',
  'apps/ios/.screenshots/iPhone19,2-iOS27.0/home-light-en.png',
  'apps/ios/build/screenshots/home-light-en.actual.png',
  '.metrics/ios/Build/Products/Release-iphonesimulator/TranVotingDemo.app/Info.plist',
  'apps/web/dist/assets/index.js',
  'apps/android/app/build/outputs/roborazzi/home.png',
  '.metrics/latest.json',
  '.agents/out/spec-gap/harness.log',
  'api.log',
];

/** Binary media is allowed only where an app ships it as an asset. */
const ASSET_FOLDERS = [/\.xcassets\//, /\/res\/(mipmap|drawable)[^/]*\//, /^apps\/web\/public\//];
const MEDIA = /\.(png|jpe?g|gif|webp|mp4|mov|zip|har|trace|xcresult)$/i;

describe('generated output stays out of git (REQ-PERF-001)', () => {
  it.each(OUTPUT_SAMPLES)('%s is ignored', (sample) => {
    // `check-ignore` exits 1 for a path that is not ignored, which makes execFileSync throw.
    expect(git('check-ignore', '--no-index', sample).trim()).toBe(sample);
  });

  it('no tracked file lives in a generated-output folder', () => {
    const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
    const outputs = tracked.filter((file) =>
      /(^|\/)(coverage|test-results|playwright-report|\.stryker-tmp|\.screenshots|\.metrics|mutants\.out[^/]*)\/|^\.agents\/out\/|\/reports\/mutation\/|\.log$/.test(
        file
      )
    );
    expect(outputs).toEqual([]);
  });

  it('no binary media is tracked outside app asset folders', () => {
    const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
    const media = tracked.filter(
      (file) => MEDIA.test(file) && !ASSET_FOLDERS.some((folder) => folder.test(file))
    );
    expect(media).toEqual([]);
  });

  it('committed reports are text', () => {
    const reports = git('ls-files', 'docs/reports').split('\n').filter(Boolean);
    expect(reports.filter((file) => !/\.(md|json)$/.test(file))).toEqual([]);
  });
});
