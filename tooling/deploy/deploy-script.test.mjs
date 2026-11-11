// Verifies: REQ-DEP-005, REQ-DEP-006
// scripts/deploy.sh on its real Compose branch, against fake docker/curl/sleep (fake-host.mjs).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { DEPLOY, composeCommand, fakeHost, image } from './fake-host.mjs';

const A = image(1);
const B = image(2);

let host;
beforeEach(() => {
  host = fakeHost();
});
afterEach(() => host.cleanup());

const deploy = (ref, extra) => host.run(DEPLOY, ['staging', ref], extra);
const commands = (run) => run.calls.map(composeCommand);
/** The image each slot was given on every docker call. */
const slotImages = (run, slot) =>
  new Set(run.calls.filter((c) => c.tool === 'docker').map((c) => c[slot]));

const START_BLUE = [
  'pull --quiet api-blue',
  'run --rm --no-deps -T api-blue check-config',
  'run --rm --no-deps -T api-blue migrate',
  'up --detach --no-deps --force-recreate api-blue',
  'curl http://127.0.0.1:3101/api/health/ready',
  'up --detach --no-deps proxy',
  'exec -T proxy nginx -t -q',
  'exec -T proxy nginx -s reload',
];

describe('a deploy runs its steps in one order (REQ-DEP-005)', () => {
  it('REQ-DEP-005 first deploy: check config, migrate, start, ready, switch, with one image', () => {
    const run = deploy(A);
    assert.equal(run.status, 0, run.out);
    assert.deepEqual(commands(run), START_BLUE);
    assert.deepEqual(slotImages(run, 'blue'), new Set([A]));
    assert.equal(host.read('staging/current'), A);
    assert.equal(host.read('staging/previous'), null);
    assert.equal(host.read('staging/active-slot'), 'blue');
    assert.equal(
      host.read('staging/proxy/active.conf'),
      'set $tran_api_upstream http://api-blue:3001;'
    );
  });

  it('REQ-DEP-005 next deploy: the other slot, and the old one drains only after the switch', () => {
    assert.equal(deploy(A).status, 0);
    const run = deploy(B, { DEPLOY_GRACE_SECONDS: '25' });
    assert.equal(run.status, 0, run.out);
    assert.deepEqual(commands(run), [
      'pull --quiet api-green',
      'run --rm --no-deps -T api-green check-config',
      'run --rm --no-deps -T api-green migrate',
      'up --detach --no-deps --force-recreate api-green',
      'curl http://127.0.0.1:3102/api/health/ready',
      'up --detach --no-deps proxy',
      'exec -T proxy nginx -t -q',
      'exec -T proxy nginx -s reload',
      'stop --timeout 25 api-blue',
      'rm --force api-blue',
    ]);
    // The new image in the new slot on every call; the old slot keeps the image it runs.
    assert.deepEqual(slotImages(run, 'green'), new Set([B]));
    assert.deepEqual(slotImages(run, 'blue'), new Set([A]));
    assert.equal(host.read('staging/current'), B);
    assert.equal(host.read('staging/previous'), A);
    assert.equal(host.read('staging/active-slot'), 'green');
    assert.match(host.read('staging/proxy/active.conf'), /api-green:3001/);
  });

  it('REQ-DEP-005 waits for ready until the deadline, probing the new slot only', () => {
    const run = deploy(A, { FAKE_READY: 'after:2', DEPLOY_READY_TIMEOUT: '10' });
    assert.equal(run.status, 0, run.out);
    const probes = commands(run).filter((c) => c.startsWith('curl') || c.startsWith('sleep'));
    assert.deepEqual(probes, [
      'curl http://127.0.0.1:3101/api/health/ready',
      'sleep 1',
      'curl http://127.0.0.1:3101/api/health/ready',
      'sleep 1',
      'curl http://127.0.0.1:3101/api/health/ready',
    ]);
  });

  it('REQ-DEP-005 a readiness failure removes the new slot and never touches the old one', () => {
    assert.equal(deploy(A).status, 0);
    const run = deploy(B, { FAKE_READY: 'never', DEPLOY_READY_TIMEOUT: '3' });
    assert.notEqual(run.status, 0);
    assert.match(run.out, /api-green was not ready .* within 3s; api-green was removed; api-blue/);
    const done = commands(run);
    assert.equal(done.filter((c) => c.startsWith('curl')).length, 3);
    assert.deepEqual(done.slice(-2), [
      'logs --no-color --tail 50 api-green',
      'rm --force --stop api-green',
    ]);
    assert.ok(!done.some((c) => c.includes('api-blue')), 'the old slot is never stopped');
    assert.ok(!done.some((c) => c.includes('proxy')), 'the proxy never switches');
    assert.equal(host.read('staging/current'), A);
    assert.equal(host.read('staging/active-slot'), 'blue');
    assert.match(host.read('staging/proxy/active.conf'), /api-blue:3001/);
  });

  for (const [step, last] of [
    ['check-config', 'run --rm --no-deps -T api-green check-config'],
    ['migrate', 'run --rm --no-deps -T api-green migrate'],
    ['pull', 'pull --quiet api-green'],
  ]) {
    it(`REQ-DEP-005 a failed ${step} stops there: nothing starts, nothing is recorded`, () => {
      assert.equal(deploy(A).status, 0);
      const run = deploy(B, { FAKE_FAIL: step });
      assert.notEqual(run.status, 0);
      assert.equal(commands(run).at(-1), last);
      assert.ok(!commands(run).some((c) => c.startsWith('up') || c.startsWith('stop')));
      assert.equal(host.read('staging/current'), A);
      assert.equal(host.read('staging/active-slot'), 'blue');
    });
  }

  it('REQ-DEP-005 a proxy that cannot switch is restored; the new slot goes, the old stays', () => {
    assert.equal(deploy(A).status, 0);
    const run = deploy(B, { FAKE_FAIL: 'nginx -t' });
    assert.notEqual(run.status, 0);
    const done = commands(run);
    assert.deepEqual(done.slice(-2), [
      'exec -T proxy nginx -s reload',
      'rm --force --stop api-green',
    ]);
    assert.ok(!done.some((c) => c.includes('api-blue')));
    assert.match(host.read('staging/proxy/active.conf'), /api-blue:3001/);
    assert.equal(host.read('staging/current'), A);
  });

  it('REQ-DEP-005 an unknown target fails loudly and runs nothing', () => {
    const run = deploy(A, { DEPLOY_TARGET: 'kubernetes' });
    assert.notEqual(run.status, 0);
    assert.match(run.out, /unknown DEPLOY_TARGET 'kubernetes'/);
    assert.deepEqual(run.calls, []);
    assert.equal(host.read('staging/current'), null);
  });

  it('REQ-DEP-005 only a full reference by digest is deployed', () => {
    for (const ref of [`sha256:${'1'.repeat(64)}`, 'ghcr.io/acme/tran/api:v1.2.3', `${A}x`]) {
      const run = deploy(ref);
      assert.notEqual(run.status, 0, ref);
      assert.match(run.out, /full reference by digest/);
      assert.deepEqual(run.calls, []);
    }
  });

  it('REQ-DEP-005 the target configuration must exist on the host', () => {
    const run = deploy(A, { DEPLOY_ENV_FILE: join(host.dir, 'missing.env') });
    assert.notEqual(run.status, 0);
    assert.match(run.out, /missing\.env does not exist/);
    assert.deepEqual(run.calls, []);
  });

  it('REQ-DEP-005 usage and environment names are checked before anything runs', () => {
    assert.equal(host.run(DEPLOY, ['staging']).status, 2);
    const run = host.run(DEPLOY, ['Prod; rm -rf /', A]);
    assert.notEqual(run.status, 0);
    assert.deepEqual(run.calls, []);
  });
});

describe('a rollback is the same deploy with the previous image (REQ-DEP-006)', () => {
  it('REQ-DEP-006 --rollback deploys the recorded previous image through every step', () => {
    assert.equal(deploy(A).status, 0);
    assert.equal(deploy(B).status, 0);
    const run = host.run(DEPLOY, ['staging', '--rollback']);
    assert.equal(run.status, 0, run.out);
    assert.deepEqual(
      commands(run).slice(0, 4),
      START_BLUE.slice(0, 4),
      'check config and migrate run again, with the previous image'
    );
    assert.deepEqual(slotImages(run, 'blue'), new Set([A]));
    assert.deepEqual(commands(run).slice(-2), [
      'stop --timeout 30 api-green',
      'rm --force api-green',
    ]);
    assert.equal(host.read('staging/current'), A);
    assert.equal(host.read('staging/previous'), B);
    assert.equal(host.read('staging/active-slot'), 'blue');
    assert.equal(host.read('staging/history').split('\n').length, 3);
  });

  it('REQ-DEP-006 deploying the previous reference by hand is the same rollback', () => {
    assert.equal(deploy(A).status, 0);
    assert.equal(deploy(B).status, 0);
    assert.equal(deploy(A).status, 0);
    assert.equal(host.read('staging/current'), A);
    assert.equal(host.read('staging/previous'), B);
  });

  it('REQ-DEP-006 with nothing recorded there is nothing to roll back to', () => {
    const run = host.run(DEPLOY, ['staging', '--rollback']);
    assert.notEqual(run.status, 0);
    assert.match(run.out, /no previous image is recorded/);
    assert.deepEqual(run.calls, []);
  });

  it('REQ-DEP-006 prints every one-way door: a contract migration and the release it names', () => {
    const migrations = join(host.dir, 'migrations');
    mkdirSync(migrations);
    writeFileSync(join(migrations, '0009_drop_old.sql'), '-- contract: v1.4.0\nSELECT 1;\n');
    writeFileSync(join(migrations, '0008_add.sql'), 'SELECT 1;\n');
    const run = deploy(A, { MIGRATIONS_DIR: migrations });
    assert.equal(run.status, 0, run.out);
    assert.match(run.out, /warning: migration 0009_drop_old\.sql has contract boundary: v1\.4\.0/);
    assert.match(run.out, /warning: rollback past v1\.4\.0 is not supported once applied/);
    assert.doesNotMatch(run.out, /0008_add/);
  });
});
