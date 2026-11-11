// Verifies: REQ-DEP-008
// deploy/remote.sh: the workflow's way onto a host. Fake ssh records every call and its stdin.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { REMOTE, fakeHost, image } from './fake-host.mjs';

const A = image(1);
const CONFIGURED = {
  DEPLOY_HOST: 'deploy.example.test',
  DEPLOY_SSH_KEY: '-----BEGIN OPENSSH KEY-----\nfake\n-----END OPENSSH KEY-----',
  DEPLOY_KNOWN_HOSTS: 'deploy.example.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIfake',
  REGISTRY_USER: 'ci-bot',
  REGISTRY_TOKEN: 'short-lived-pull-token',
};

let host;
beforeEach(() => {
  host = fakeHost();
});
afterEach(() => host.cleanup());

const remote = (extra = {}, args = ['staging', A]) =>
  host.run(REMOTE, args, { ...CONFIGURED, ...extra });

describe('deploys run on the host over SSH (REQ-DEP-008)', () => {
  it('REQ-DEP-008 ships the bundle, logs in by stdin, deploys the reference, logs out', () => {
    const run = remote();
    assert.equal(run.status, 0, run.out);
    const calls = run.calls.filter((c) => c.tool === 'ssh');
    const commands = calls.map((c) => c.args.split(' deploy@deploy.example.test ')[1]);
    assert.deepEqual(commands, [
      'mkdir -p tran && tar -xzf - -C tran',
      'docker login ghcr.io --username ci-bot --password-stdin',
      `cd tran && bash scripts/deploy.sh staging ${A}`,
      'docker logout ghcr.io',
    ]);
    // The bundle is a gzip archive holding the script, the target and the migrations.
    const bundle = host.stdin(calls[0]);
    assert.deepEqual([...bundle.subarray(0, 2)], [0x1f, 0x8b]);
    const listing = execFileSync('tar', ['-tzf', '-'], { input: bundle, encoding: 'utf8' });
    for (const path of ['scripts/deploy.sh', 'deploy/compose.yaml', 'deploy/proxy/nginx.conf'])
      assert.ok(listing.split('\n').includes(path), path);
    assert.ok(listing.includes('apps/api/migrations/'));
    // The token reaches docker on stdin, never on a command line.
    assert.equal(host.stdin(calls[1]).toString(), CONFIGURED.REGISTRY_TOKEN);
    assert.ok(!run.calls.some((c) => c.args.includes(CONFIGURED.REGISTRY_TOKEN)));
    assert.ok(!run.out.includes(CONFIGURED.REGISTRY_TOKEN));
  });

  it('REQ-DEP-008 checks the host key strictly against configuration, never on first use', () => {
    const run = remote();
    for (const call of run.calls.filter((c) => c.tool === 'ssh')) {
      assert.match(call.args, /-o StrictHostKeyChecking=yes/);
      assert.match(call.args, /-o UserKnownHostsFile=\S+\/known_hosts/);
      assert.match(call.args, /-o BatchMode=yes/);
      assert.doesNotMatch(call.args, /StrictHostKeyChecking=(no|accept-new)/);
    }
  });

  it('REQ-DEP-008 the deploy failing on the host fails the job, and still logs out', () => {
    const run = remote({ FAKE_FAIL: 'scripts/deploy.sh' });
    assert.notEqual(run.status, 0);
    assert.match(run.calls.at(-1).args, /docker logout ghcr.io$/);
  });

  it('REQ-DEP-008 user and folder come from configuration and are quoted', () => {
    const run = remote({ DEPLOY_USER: 'ops', DEPLOY_PATH: '/srv/tran app' });
    assert.notEqual(run.status, 0, 'a folder with a space is refused');
    const ok = remote({ DEPLOY_USER: 'ops', DEPLOY_PATH: '/srv/tran' });
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.calls[0].args, / ops@deploy\.example\.test mkdir -p \/srv\/tran /);
  });

  it('REQ-DEP-008 refuses a bare digest, a tag, or missing host configuration', () => {
    for (const ref of [`sha256:${'1'.repeat(64)}`, 'ghcr.io/acme/tran/api:v1']) {
      const run = remote({}, ['production', ref]);
      assert.notEqual(run.status, 0, ref);
      assert.deepEqual(run.calls, []);
    }
    for (const name of ['DEPLOY_HOST', 'DEPLOY_SSH_KEY', 'DEPLOY_KNOWN_HOSTS']) {
      const run = remote({ [name]: '' });
      assert.notEqual(run.status, 0, name);
      assert.match(run.out, new RegExp(`${name} is not set`));
      assert.deepEqual(run.calls, []);
    }
  });
});

describe('a deploy to a real host (REQ-DEP-008)', () => {
  const live = ['DEPLOY_HOST', 'DEPLOY_SSH_KEY', 'DEPLOY_KNOWN_HOSTS', 'DEPLOY_TEST_IMAGE'];
  it('REQ-DEP-008 ships, deploys and serves on the configured host', (t) => {
    if (live.some((name) => !process.env[name]))
      return t.skip(
        'TODO(credentials): DEPLOY_HOST, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, DEPLOY_TEST_IMAGE - the bundle reaches a real host over SSH and the image passes check-config, migrate and readiness there'
      );
    const output = execFileSync('bash', [REMOTE, 'staging', process.env.DEPLOY_TEST_IMAGE], {
      encoding: 'utf8',
      env: process.env,
    });
    assert.match(output, /Deploy complete/);
  });
});
