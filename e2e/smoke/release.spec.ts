// Verifies: REQ-PERF-008
/**
 * Release builds start and work — the builds users get, not the debug ones every other suite
 * runs. `pnpm smoke` builds them first. A check whose tool or device is missing is reported as
 * skipped, with the reason, never as passed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const APK = path.join(ROOT, 'apps/android/app/build/outputs/apk/release/app-release-unsigned.apk');
const IOS_APP = path.join(
  ROOT,
  '.metrics/ios/Build/Products/Release-iphonesimulator/TranVotingDemo.app'
);
/** The ABIs `apps/android/scripts/build-rust-lib.sh` stages; each must ship the Rust core. */
const ANDROID_ABIS = ['arm64-v8a', 'x86_64'];
const PACKAGE = 'com.tran.voting';

const run = (command: string, args: string[]) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const has = (command: string) => {
  try {
    run('which', [command]);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('web: the production build loads cleanly and answers a server check', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByText('API online')).toBeVisible();
  await page.getByRole('radio', { name: /Ask the server/ }).check();
  await page.getByLabel('Your age').fill('20');
  await page.getByLabel('Country code').fill('NP');
  await page.getByRole('button', { name: 'Check eligibility' }).click();
  await expect(page.getByText('Age 20 meets the minimum voting age of 18 in NP.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('android: the release APK ships the Rust core for every ABI', () => {
  test.skip(!existsSync(APK), `no release APK at ${path.relative(ROOT, APK)} — run pnpm smoke`);
  const listing = run('unzip', ['-l', APK]);
  for (const abi of ANDROID_ABIS) expect(listing).toContain(`lib/${abi}/libtran_uniffi.so`);
  expect(listing).toContain('classes.dex');
});

test('android: the release APK launches and stays running', async () => {
  test.setTimeout(120_000);
  const sdk = process.env.ANDROID_HOME ?? path.join(homedir(), 'Library/Android/sdk');
  const devices = has('adb') ? run('adb', ['devices']).split('\n').slice(1) : [];
  test.skip(!existsSync(APK), 'no release APK — run pnpm smoke');
  test.skip(
    !devices.some((line) => /\tdevice$/.test(line)),
    'no Android device or emulator attached'
  );

  // Release is unsigned in the template; sign a copy with the debug key so it can be installed.
  const tools = path.join(sdk, 'build-tools');
  const latest = run('ls', [tools]).split('\n').filter(Boolean).sort().at(-1)!;
  const work = mkdtempSync(path.join(tmpdir(), 'tran-smoke-'));
  const signed = path.join(work, 'release-signed.apk');
  try {
    run(path.join(tools, latest, 'apksigner'), [
      'sign',
      '--ks',
      path.join(homedir(), '.android/debug.keystore'),
      '--ks-pass',
      'pass:android',
      '--out',
      signed,
      APK,
    ]);
    // A debug build signed with the same key may be installed; replace it either way.
    try {
      run('adb', ['uninstall', PACKAGE]);
    } catch {
      // Not installed.
    }
    run('adb', ['install', '-r', signed]);
    run('adb', ['logcat', '-c']);
    // No `-W`: on a sleeping emulator it waits out its own 20 s timeout before reporting.
    run('adb', ['shell', 'am', 'start', '-n', `${PACKAGE}/.MainActivity`]);
    const pid = () => {
      try {
        return run('adb', ['shell', 'pidof', PACKAGE]);
      } catch {
        return ''; // pidof exits 1 while the process does not exist yet.
      }
    };
    await expect.poll(pid, { timeout: 30_000 }).toMatch(/^\d+$/);
    const started = pid();
    await sleep(3_000);
    expect(pid(), 'the app exited or restarted within 3 s of launch').toBe(started);
    expect(run('adb', ['logcat', '-d', '-b', 'crash'])).not.toContain(PACKAGE);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('ios: the Release app launches on a simulator and stays running', async () => {
  test.setTimeout(120_000);
  test.skip(process.platform !== 'darwin', 'iOS needs macOS');
  test.skip(
    !existsSync(IOS_APP),
    `no Release app at ${path.relative(ROOT, IOS_APP)} — run pnpm smoke`
  );
  const line = run('xcrun', ['simctl', 'list', 'devices', 'available'])
    .split('\n')
    .find((entry) => /^\s+iPhone[^(]* \([0-9A-F-]{36}\)/.test(entry));
  test.skip(!line, 'no available iPhone simulator');
  const udid = /\(([0-9A-F-]{36})\)/.exec(line!)![1]!;

  run('xcrun', ['simctl', 'bootstatus', udid, '-b']);
  run('xcrun', ['simctl', 'install', udid, IOS_APP]);
  // `simctl launch` prints `<bundle id>: <pid>`; simulator apps are host processes.
  const pid = Number(
    run('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, PACKAGE]).split(': ')[1]
  );
  expect(pid).toBeGreaterThan(0);
  await sleep(3_000);
  expect(() => process.kill(pid, 0), 'the app exited within 3 s of launch').not.toThrow();
  run('xcrun', ['simctl', 'terminate', udid, PACKAGE]);
});
