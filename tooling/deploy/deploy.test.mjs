// Verifies: REQ-DEP-001, REQ-DEP-002, REQ-DEP-004, REQ-DEP-005, REQ-DEP-006, REQ-DEP-008
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('the API container image (REQ-DEP-001)', () => {
  const dockerfile = readFileSync(join(ROOT, 'apps/api/Dockerfile'), 'utf8');

  it('is a multi-stage build with base images pinned by sha256 digest', () => {
    const froms = [...dockerfile.matchAll(/^\s*FROM\s+([^\s]+)/gm)].map((m) => m[1]);
    expectMultiStage: {
      assert.ok(froms.length >= 2, 'must have at least 2 stages');
    }
    for (const img of froms) {
      if (img.toLowerCase() === 'scratch') continue;
      assert.match(img, /@sha256:[0-9a-fA-F]{64}$/, `${img} must be pinned to a sha256 digest`);
    }
  });

  it('builds with --locked and passes version and commit args', () => {
    assert.match(dockerfile, /cargo build [^\n]*--locked/, 'must build with --locked');
    assert.match(dockerfile, /ARG\s+VERSION/, 'must accept VERSION build arg');
    assert.match(dockerfile, /ARG\s+COMMIT/, 'must accept COMMIT build arg');
  });

  it('runs as a non-root user and removes shell and package manager in runtime', () => {
    assert.match(dockerfile, /USER\s+tran:tran/, 'runtime must run as tran:tran non-root user');
    assert.match(dockerfile, /rm -rf[^\n]*\/sbin\/apk/, 'must remove apk package manager');
    assert.match(dockerfile, /rm -rf[^\n]*\/bin\/sh/, 'must remove shell');
  });
});

describe('image holds no configuration and no secret (REQ-DEP-002)', () => {
  const dockerfile = readFileSync(join(ROOT, 'apps/api/Dockerfile'), 'utf8');
  const dockerignore = readFileSync(join(ROOT, 'apps/api/.dockerignore'), 'utf8');

  it('Dockerfile does not set secret-like ARG or ENV', () => {
    const secretPattern = /SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|API_?KEY/i;
    for (const line of dockerfile.split('\n')) {
      if (/^\s*(?:ARG|ENV)\s+/i.test(line)) {
        assert.ok(!secretPattern.test(line), `secret-like variable in Dockerfile: ${line}`);
      }
    }
  });

  it('.dockerignore excludes .env*, data/, signing material, and .git', () => {
    assert.match(dockerignore, /\.git/, '.dockerignore must exclude .git');
    assert.match(dockerignore, /\.env\*/, '.dockerignore must exclude .env*');
    assert.match(dockerignore, /data\//, '.dockerignore must exclude data/');
    assert.match(dockerignore, /\*\.p8/, '.dockerignore must exclude *.p8');
    assert.match(dockerignore, /\*\.pem/, '.dockerignore must exclude *.pem');
    assert.match(dockerignore, /\*\.keystore|\*\.jks/, '.dockerignore must exclude keystores');
  });
});

describe('image built once and promoted by digest (REQ-DEP-004)', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');

  it('builds once on tag with SBOM and provenance', () => {
    assert.match(workflow, /provenance:\s*mode=max/, 'must generate provenance attestation');
    assert.match(workflow, /sbom:\s*true/, 'must generate SBOM');
    assert.match(workflow, /outputs:\s*\n\s*digest:/, 'must export built image digest as output');
  });

  it('promotes image digest to staging and production without rebuilding', () => {
    assert.match(workflow, /scripts\/deploy\.sh staging/, 'staging must deploy with deploy.sh');
    assert.match(workflow, /scripts\/deploy\.sh production/, 'production must deploy with deploy.sh');
    assert.ok(!workflow.includes('docker build apps/api/Dockerfile -t production'), 'production must not rebuild');
  });
});

describe('deploy order and rollback (REQ-DEP-005, REQ-DEP-006)', () => {
  it('executes steps in strict order: validate -> migrate -> start -> wait ready -> drain old', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'deploy-test-'));
    try {
      const traceLog = join(tempDir, 'trace.log');
      const fakeTarget = join(tempDir, 'fake-target.sh');
      writeFileSync(
        fakeTarget,
        `#!/usr/bin/env bash\necho "$1" >> "${traceLog}"\nexit 0\n`
      );
      chmodSync(fakeTarget, 0o755);

      const deployScript = join(ROOT, 'scripts/deploy.sh');
      execFileSync(deployScript, ['staging', 'sha256:testimage123'], {
        env: {
          ...process.env,
          DEPLOY_TARGET: 'mock',
          DEPLOY_TARGET_CMD: fakeTarget,
          DEPLOY_STATE_DIR: tempDir,
        },
      });

      const trace = readFileSync(traceLog, 'utf8').trim().split('\n');
      assert.deepEqual(trace, [
        'validate-config',
        'migrate',
        'start-new',
        'wait-ready',
        'drain-old',
      ]);

      const savedDigest = readFileSync(join(tempDir, 'staging.digest'), 'utf8').trim();
      assert.equal(savedDigest, 'sha256:testimage123');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails early and aborts before starting new version if migration fails', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'deploy-fail-'));
    try {
      const traceLog = join(tempDir, 'trace.log');
      const fakeTarget = join(tempDir, 'fake-target.sh');
      writeFileSync(
        fakeTarget,
        `#!/usr/bin/env bash\necho "$1" >> "${traceLog}"\nif [ "$1" = "migrate" ]; then exit 1; fi\nexit 0\n`
      );
      chmodSync(fakeTarget, 0o755);

      const deployScript = join(ROOT, 'scripts/deploy.sh');
      assert.throws(
        () =>
          execFileSync(deployScript, ['staging', 'sha256:badimage'], {
            env: {
              ...process.env,
              DEPLOY_TARGET: 'mock',
              DEPLOY_TARGET_CMD: fakeTarget,
              DEPLOY_STATE_DIR: tempDir,
            },
          }),
        /Command failed/
      );

      const trace = readFileSync(traceLog, 'utf8').trim().split('\n');
      assert.deepEqual(trace, ['validate-config', 'migrate']);
      assert.ok(!existsSync(join(tempDir, 'staging.digest')));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('REQ-DEP-006 warns when migration defines a contract boundary', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'deploy-contract-'));
    try {
      const fakeMigDir = join(tempDir, 'migrations');
      mkdirSync(fakeMigDir);
      writeFileSync(
        join(fakeMigDir, '009_contract.sql'),
        '-- contract: v1.0.0\nCREATE TABLE test (id INT);\n'
      );

      const fakeTarget = join(tempDir, 'fake-target.sh');
      writeFileSync(fakeTarget, '#!/usr/bin/env bash\nexit 0\n');
      chmodSync(fakeTarget, 0o755);

      const deployScript = join(ROOT, 'scripts/deploy.sh');
      const output = execFileSync(deployScript, ['staging', 'sha256:test'], {
        env: {
          ...process.env,
          DEPLOY_TARGET: 'mock',
          DEPLOY_TARGET_CMD: fakeTarget,
          DEPLOY_STATE_DIR: tempDir,
          MIGRATIONS_DIR: fakeMigDir,
        },
      }).toString('utf8');

      assert.match(output, /warning: migration 009_contract\.sql has contract boundary: v1\.0\.0/);
      assert.match(output, /warning: rollback past v1\.0\.0 is not supported once applied/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('production deploys are deliberate and gated (REQ-DEP-008)', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');

  it('runs staging automatically and production only on manual dispatch', () => {
    assert.match(workflow, /deploy-staging:\s*\n[^\n]*\n\s*needs:\s*build-image/);
    assert.match(
      workflow,
      /deploy-production:\s*[\s\S]*?github\.event_name == 'workflow_dispatch' && github\.event\.inputs\.target_env == 'production'/,
      'production deploy must only trigger on manual dispatch with target_env == production'
    );
  });

  it('uses protected environments for staging and production', () => {
    assert.match(workflow, /environment:\s*staging/);
    assert.match(workflow, /environment:\s*production/);
  });

  it('skips with notice and TODO(credentials) marker when deploy target is unconfigured', () => {
    assert.match(workflow, /TODO\(credentials\):\s*DEPLOY_HOST/);
  });
});
