// Verifies: REQ-DEP-001, REQ-DEP-002, REQ-DEP-005
// The Compose target and the image recipe, parsed. What the image does when run is proven by
// e2e/smoke/image.spec.ts (pnpm deploy:smoke); this file keeps the recipe from drifting between runs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ROOT } from './fake-host.mjs';
import { parseYaml } from './yaml.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const compose = parseYaml(read('deploy/compose.yaml'));
const slots = ['api-blue', 'api-green'];
const target = (mount) => mount.split(':')[1] ?? mount.split(':')[0];

describe('the Compose target (REQ-DEP-005)', () => {
  it('REQ-DEP-005 two API slots, read-only, uid 10001, each with its own image variable', () => {
    for (const slot of slots) {
      const service = compose.services[slot];
      assert.equal(service.read_only, true, slot);
      assert.equal(service.user, '10001:10001', slot);
      assert.equal(service.stop_signal, 'SIGTERM', slot);
      const colour = slot.split('-')[1].toUpperCase();
      assert.match(service.image, new RegExp(`^\\$\\{API_${colour}_IMAGE:\\?`), slot);
    }
  });

  it('REQ-DEP-005 no mount point twice; /data is the volume, /tmp a tmpfs', () => {
    for (const [name, service] of Object.entries(compose.services)) {
      const points = [
        ...(service.volumes ?? []).map(target),
        ...(service.tmpfs ?? []).map((t) => t.split(':')[0]),
      ];
      assert.equal(new Set(points).size, points.length, `${name}: ${points}`);
    }
    for (const slot of slots) {
      assert.deepEqual(compose.services[slot].volumes, ['data:/data']);
      assert.match(compose.services[slot].tmpfs[0], /^\/tmp:/);
    }
  });

  it('REQ-DEP-005 slots publish on loopback only; the proxy owns the public port', () => {
    for (const slot of slots)
      for (const port of compose.services[slot].ports) assert.match(port, /^127\.0\.0\.1:/, slot);
    assert.deepEqual(compose.services.proxy.ports, ['${PUBLIC_PORT:-8080}:8080']);
    assert.match(compose.services.proxy.image, /^nginx:[\w.-]+@sha256:[0-9a-f]{64}$/);
    assert.equal(compose.services.proxy.read_only, true);
  });

  it('REQ-DEP-005 nothing environment-specific: configuration comes from the env file', () => {
    for (const slot of slots) {
      assert.deepEqual(compose.services[slot].environment, { MIGRATE_ON_START: 'false' });
      assert.match(compose.services[slot].env_file, /^\$\{DEPLOY_ENV_FILE:\?/);
    }
    assert.doesNotMatch(read('deploy/compose.yaml'), /APP_ENV|production|staging/);
    assert.doesNotMatch(read('scripts/deploy.sh'), /\b(production|staging)\b/);
  });

  it('REQ-DEP-005 the proxy forwards to the slot the deploy names, resolved per request', () => {
    const conf = read('deploy/proxy/nginx.conf');
    assert.match(conf, /include \/etc\/nginx\/tran\/active\.conf;/);
    assert.match(conf, /proxy_pass \$tran_api_upstream;/);
    assert.match(conf, /resolver 127\.0\.0\.11/);
    assert.ok(
      compose.services.proxy.volumes.includes(
        '${DEPLOY_PROXY_DIR:?scripts/deploy.sh sets the proxy state folder}:/etc/nginx/tran:ro'
      )
    );
  });

  it('REQ-DEP-006 host state never dirties the repository', () => {
    assert.ok(read('.gitignore').split('\n').includes('deploy/state/'));
  });
});

describe('the image recipe (REQ-DEP-001, REQ-DEP-002)', () => {
  const dockerfile = read('apps/api/Dockerfile');
  const instructions = dockerfile
    .split('\n')
    .filter((line) => /^[A-Z]+\s/.test(line))
    .map((line) => line.split(/\s+/)[0]);

  it('REQ-DEP-001 a static binary on scratch, run as 10001, built --locked', () => {
    const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
    assert.equal(froms.at(-1), 'scratch');
    assert.match(froms[0], /^rust:[\d.]+-alpine[\d.]+@sha256:[0-9a-f]{64}$/);
    assert.match(dockerfile, /cargo build --release --locked -p api/);
    assert.match(dockerfile, /readelf -d target\/release\/api \| grep -q NEEDED/);
    assert.match(dockerfile, /^USER 10001:10001$/m);
    assert.match(dockerfile, /^ENTRYPOINT \["\/api"\]$/m);
  });

  it('REQ-DEP-002 no ENV at all; ARGs are the version and the commit', () => {
    assert.ok(!instructions.includes('ENV'));
    assert.deepEqual(
      [...dockerfile.matchAll(/^ARG\s+(\w+)/gm)].map((m) => m[1]),
      ['VERSION', 'COMMIT']
    );
  });

  it('REQ-DEP-001 copies every path the workspace build reads', () => {
    const copied = [...dockerfile.matchAll(/^COPY (?!--from)(.+) \S+$/gm)].flatMap((m) =>
      m[1].split(' ')
    );
    const members = [...read('Cargo.toml').matchAll(/^\s+"([^"]+)",?$/gm)].map((m) => m[1]);
    for (const member of members)
      assert.ok(
        copied.some((path) => `${member}/`.startsWith(path)),
        `${member} is not copied`
      );
    // include_str! paths outside the crate, in non-test code: the push payload's locales.
    const payload = read('apps/api/src/push/payload.rs').split('#[cfg(test)]')[0];
    const outside = [...payload.matchAll(/include_str!\("(?:\.\.\/){4}([^/]+)\//g)].map(
      (m) => m[1]
    );
    assert.ok(outside.length > 0, 'the payload embeds the locales');
    for (const dir of new Set(outside))
      assert.ok(copied.includes(`${dir}/`), `${dir}/ is embedded but not copied`);
  });
});

describe('the YAML reader the deploy tests rely on', () => {
  it('reads maps, sequences, block scalars, flow lists, anchors and comments', () => {
    const parsed = parseYaml(
      [
        'a: 1 # comment',
        'b: [\'v*\', "x"]',
        'base: &base',
        '  k: v',
        'c:',
        '  <<: *base',
        '  run: |',
        '    one',
        '    two # kept',
        '  list:',
        '    - name: n',
        '      with: {}',
        '    - plain',
        'd: true',
        "e: 'it''s'",
      ].join('\n')
    );
    assert.deepEqual(parsed, {
      a: 1,
      b: ['v*', 'x'],
      base: { k: 'v' },
      c: { k: 'v', run: 'one\ntwo # kept\n', list: [{ name: 'n', with: {} }, 'plain'] },
      d: true,
      e: "it's",
    });
  });

  it('throws on what it cannot read', () => {
    assert.throws(() => parseYaml('a: {b: 1}'), /flow maps/);
    assert.throws(() => parseYaml('a: *missing'), /unknown anchor/);
    assert.throws(() => parseYaml('a: 1\n  b: 2'), /unexpected/);
  });
});
