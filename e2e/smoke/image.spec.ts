// Verifies: REQ-DEP-001, REQ-DEP-002, REQ-DEP-003, REQ-DEP-007
/**
 * Image smoke test (spec 032, `pnpm deploy:smoke`, its own config `playwright.image.config.ts`): build
 * the API image, then run it the way the Compose target does (docs/DEPLOY.md): read-only root, the
 * image's own user, a named volume on /data and the configuration only from the environment.
 * `check-config` and `migrate` run as their own containers first; the server must become ready, sign
 * a user in, answer a product route and exit 0 on SIGTERM within its grace period.
 *
 * The one skip: no container runtime (`docker` missing or its daemon down), allow-listed in
 * tooling/todos/allow.json. In CI it never skips; a missing runtime fails there.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
/** `TRAN_SMOKE_IMAGE` proves an image built elsewhere (a published one); unset, the checkout is built. */
const PREBUILT = process.env.TRAN_SMOKE_IMAGE;
const IMAGE = PREBUILT || 'tran-api:smoke';
const SUFFIX = randomBytes(4).toString('hex');
const CONTAINER = `tran-api-smoke-${SUFFIX}`;
const VOLUME = `tran-api-smoke-data-${SUFFIX}`;
const GRACE_MS = 5_000;
const ORIGIN = 'https://app.example.test';
/** What a production target sets (its env file); nothing in the image says which environment it is. */
const PRODUCTION_ENV = [
  '-e',
  'APP_ENV=production',
  '-e',
  `CORS_ALLOWED_ORIGINS=${ORIGIN}`,
  '-e',
  'MIGRATE_ON_START=false',
  '-e',
  `SHUTDOWN_GRACE_MS=${GRACE_MS}`,
];

const docker = (args: string[], timeout = 60_000) =>
  execFileSync('docker', args, { cwd: ROOT, encoding: 'utf8', timeout }).trim();
/** Exit status and output, for commands that are expected to fail. */
const dockerStatus = (args: string[]) => {
  const result = spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

const runtime =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  }).status === 0;

test.describe.configure({ mode: 'serial' });

test('REQ-DEP-007 the image starts read-only as uid 10001, serves, and exits 0 on SIGTERM', async ({
  request,
}) => {
  test.skip(
    !runtime && !process.env.CI,
    'no container runtime: docker is not installed or its daemon is not running'
  );

  const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

  await test.step('build (REQ-DEP-001)', () => {
    if (PREBUILT) return;
    execFileSync(
      'docker',
      [
        'build',
        '--file',
        'apps/api/Dockerfile',
        '--build-arg',
        `VERSION=${version}`,
        '--build-arg',
        `COMMIT=${commit}`,
        '--tag',
        IMAGE,
        '.',
      ],
      { cwd: ROOT, stdio: 'inherit', timeout: 30 * 60_000 }
    );
  });

  try {
    await test.step('no environment, no shell, a non-root user (REQ-DEP-001, REQ-DEP-002)', () => {
      const config = JSON.parse(
        docker(['image', 'inspect', '--format', '{{json .Config}}', IMAGE])
      );
      expect(config.User).toBe('10001:10001');
      const env: string[] = config.Env ?? [];
      expect(env.filter((entry) => !entry.startsWith('PATH='))).toEqual([]);
      const size = Number(docker(['image', 'inspect', '--format', '{{.Size}}', IMAGE]));
      test.info().annotations.push({ type: 'image size', description: `${size} bytes` });
      const shell = dockerStatus(['run', '--rm', '--entrypoint', '/bin/sh', IMAGE, '-c', 'true']);
      expect(shell.status, shell.output).not.toBe(0);
      docker(['volume', 'create', VOLUME]);
    });

    const oneShot = (env: string[], command: string) =>
      dockerStatus(['run', '--rm', '--read-only', '-v', `${VOLUME}:/data`, ...env, IMAGE, command]);

    await test.step('check-config, then migrate, as their own containers (REQ-DEP-003)', () => {
      const missing = oneShot(['-e', 'APP_ENV=production'], 'check-config');
      expect(missing.status, missing.output).not.toBe(0);
      expect(missing.output).toContain('CORS_ALLOWED_ORIGINS');
      const valid = oneShot(PRODUCTION_ENV, 'check-config');
      expect(valid.status, valid.output).toBe(0);
      const migrated = oneShot(PRODUCTION_ENV, 'migrate');
      expect(migrated.status, migrated.output).toBe(0);
    });

    let base = '';
    await test.step('start read-only and wait for ready', async () => {
      docker([
        'run',
        '--detach',
        '--name',
        CONTAINER,
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=64m',
        '-v',
        `${VOLUME}:/data`,
        '-p',
        '127.0.0.1::3001',
        ...PRODUCTION_ENV,
        IMAGE,
      ]);
      expect(docker(['inspect', '--format', '{{.HostConfig.ReadonlyRootfs}}', CONTAINER])).toBe(
        'true'
      );
      base = `http://${docker(['port', CONTAINER, '3001/tcp']).split('\n')[0]}`;
      await expect
        .poll(
          async () => {
            try {
              return (await request.get(`${base}/api/health/ready`)).status();
            } catch {
              return 0;
            }
          },
          { timeout: 60_000, intervals: [250, 500, 1_000] }
        )
        .toBe(200);
      const uids = docker(['top', CONTAINER, '-o', 'pid,uid'])
        .split('\n')
        .slice(1)
        .map((line) => line.trim().split(/\s+/)[1]);
      expect(uids.length).toBeGreaterThan(0);
      expect(uids.every((uid) => uid === '10001')).toBe(true);
    });

    await test.step('sign in and call product routes', async () => {
      const signIn = await request.post(`${base}/api/v1/auth/session`, {
        headers: { Origin: ORIGIN },
        data: { role: 'citizen_voter', transport: 'body' },
      });
      expect(signIn.ok(), await signIn.text()).toBe(true);
      const { access_token: token } = await signIn.json();
      expect(typeof token).toBe('string');

      const session = await request.get(`${base}/api/v1/auth/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(session.status()).toBe(200);
      expect((await session.json()).role).toBe('citizen_voter');

      const countries = await request.get(`${base}/api/v1/vote/countries`);
      expect(countries.status()).toBe(200);
      const eligibility = await request.post(`${base}/api/v1/vote/eligibility`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { age: 30 },
      });
      expect(eligibility.status(), await eligibility.text()).toBe(200);
      expect(typeof (await eligibility.json()).eligible).toBe('boolean');
    });

    await test.step('the start-up event names the commit the image was built from (REQ-DEP-001)', () => {
      // A prebuilt image's commit is known only when TRAN_SMOKE_COMMIT says it.
      const expected = PREBUILT ? process.env.TRAN_SMOKE_COMMIT : commit;
      if (!expected) return;
      // At least the first 12 characters: a short SHA counts.
      expect(docker(['logs', CONTAINER])).toContain(expected.slice(0, 12));
    });

    await test.step('SIGTERM: exit 0 within the grace period', () => {
      const started = Date.now();
      docker(['kill', '--signal', 'SIGTERM', CONTAINER]);
      const code = docker(['wait', CONTAINER], GRACE_MS + 10_000);
      expect(code).toBe('0');
      expect(Date.now() - started).toBeLessThan(GRACE_MS + 5_000);
    });
  } finally {
    dockerStatus(['rm', '--force', CONTAINER]);
    dockerStatus(['volume', 'rm', '--force', VOLUME]);
  }
});
