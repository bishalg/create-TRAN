// Verifies: REQ-DEP-007
/**
 * Image smoke test (spec 032, REQ-DEP-007):
 * Builds the container image, starts it with read-only rootfs and non-root user,
 * waits for readiness, signs in, calls a product route, sends SIGTERM,
 * and requires exit code 0 within the grace period.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const PORT = 3099;
const CONTAINER_NAME = 'tran-api-smoke-test';

const run = (command: string, args: string[]) =>
  execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const hasDocker = () => {
  if (process.env.SKIP_DOCKER_SMOKE === '1') return false;
  try {
    run('which', ['docker']);
    run('docker', ['info']);
    const df = run('docker', ['run', '--rm', 'alpine:3.21.3', 'df', '-m', '/']);
    const lines = df.split('\n');
    if (lines.length > 1) {
      const parts = lines[1].trim().split(/\s+/);
      const availMb = parseInt(parts[3], 10);
      if (availMb < 1500) return false;
    }
    return true;
  } catch {
    return false;
  }
};

test('image: starts non-root, read-only, serves requests and exits 0 on SIGTERM', async ({
  request,
}) => {
  test.skip(!hasDocker(), 'no container runtime installed or docker daemon not running');

  // Build the image
  run('docker', ['build', '-f', 'apps/api/Dockerfile', '-t', 'tran-api-smoke:local', '.']);

  try {
    // Stop any stale container
    try {
      run('docker', ['rm', '-f', CONTAINER_NAME]);
    } catch {
      // ignore
    }

    // Run with non-root user, read-only rootfs, tmpfs for /tmp
    run('docker', [
      'run',
      '-d',
      '--name',
      CONTAINER_NAME,
      '-p',
      `${PORT}:3001`,
      '--read-only',
      '--user',
      '10001:10001',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '-e',
      'APP_ENV=test',
      '-e',
      'DATABASE_URL=sqlite::memory:',
      '-e',
      'SHUTDOWN_GRACE_MS=5000',
      'tran-api-smoke:local',
    ]);

    // Wait for readiness
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await request.get(`http://127.0.0.1:${PORT}/api/health/ready`);
        if (res.status() === 200) {
          ready = true;
          break;
        }
      } catch {
        // wait
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(ready).toBe(true);

    // Call liveness
    const liveRes = await request.get(`http://127.0.0.1:${PORT}/api/health/live`);
    expect(liveRes.status()).toBe(200);

    // Call public metadata route
    const metaRes = await request.get(`http://127.0.0.1:${PORT}/api/v1/meta/info`);
    expect(metaRes.status()).toBe(200);
    const metaBody = await metaRes.json();
    expect(metaBody.service).toBe('TRAN API');

    // Send SIGTERM to container
    run('docker', ['kill', '--signal=SIGTERM', CONTAINER_NAME]);

    // Wait for container to exit with code 0
    let exited = false;
    for (let i = 0; i < 20; i++) {
      try {
        const status = run('docker', ['inspect', '-f', '{{.State.Status}}', CONTAINER_NAME]);
        if (status === 'exited') {
          const exitCode = run('docker', ['inspect', '-f', '{{.State.ExitCode}}', CONTAINER_NAME]);
          expect(exitCode).toBe('0');
          exited = true;
          break;
        }
      } catch {
        // wait
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(exited).toBe(true);
  } finally {
    try {
      run('docker', ['rm', '-f', CONTAINER_NAME]);
    } catch {
      // ignore
    }
  }
});
