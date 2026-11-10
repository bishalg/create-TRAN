// Verifies: REQ-VER-002
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  compareVersions,
  diffContract,
  diffRequests,
  diffResponses,
  diffRoutes,
  shapeOf,
  typeOf,
} from './contract.mjs';

const SCRIPT = fileURLToPath(new URL('./contract.mjs', import.meta.url));

const token = {
  route: 'POST /api/v1/auth/session',
  status: 201,
  body: { access_token: 't', expires_in: 900, user: { user_id: 'u', role: 'citizen_voter' } },
};
const health = {
  route: 'GET /api/health',
  status: 200,
  body: { components: [{ name: 'rust-core', healthy: true }] },
};
const failure = { route: 'GET /api/v1/nope', status: 404, body: { code: 'route.not_found' } };

describe('shapes', () => {
  it('names every field by dotted path, arrays with []', () => {
    const shape = shapeOf(health.body);
    assert.deepEqual([...shape.keys()], ['components', 'components[]', 'components[].name', 'components[].healthy']);
    assert.deepEqual([...shape.get('components[].healthy')], ['boolean']);
    assert.equal(typeOf(null), 'null');
    assert.equal(typeOf([]), 'array');
    assert.equal(shapeOf(null).size, 0);
  });
});

describe('diffResponses (REQ-VER-002)', () => {
  it('allows a new field, a new route and a new error', () => {
    const grown = { ...token, body: { ...token.body, scope: 'vote', user: { ...token.body.user, team: 'n' } } };
    assert.deepEqual(diffResponses([token], [grown, health, failure]), []);
  });

  it('fails on a removed, a renamed or a retyped field', () => {
    const changed = {
      ...token,
      body: { access_token: 't', expires_in: '900', user: { id: 'u', role: 'citizen_voter' } },
    };
    assert.deepEqual(diffResponses([token], [changed]), [
      'POST /api/v1/auth/session 201: field expires_in changed type from number to string',
      'POST /api/v1/auth/session 201: field user.user_id was removed or renamed',
    ]);
  });

  it('fails when a success is no longer answered, not when an error case goes', () => {
    assert.deepEqual(diffResponses([token, failure], []), [
      'POST /api/v1/auth/session 201: no longer answered',
    ]);
  });

  it('merges the cases of one route and status', () => {
    const other = { ...health, body: { components: [{ name: 'axum', healthy: false, uptime: 1 }] } };
    assert.deepEqual(diffResponses([health, other], [other]), []);
  });
});

describe('diffRoutes and diffRequests (REQ-VER-002)', () => {
  it('fails on a removed route only', () => {
    assert.deepEqual(diffRoutes(['GET /a', 'GET /b'], ['GET /b', 'GET /c']), ['GET /a: route removed']);
  });

  it('fails on a newly required, a retyped or a removed request field', () => {
    const before = {
      'POST /x': { age: { type: 'number', required: true }, note: { type: 'string', required: false }, gone: { type: 'string', required: false } },
    };
    const after = {
      'POST /x': {
        age: { type: 'string', required: true },
        note: { type: 'string', required: true },
        extra: { type: 'boolean', required: false },
      },
      'POST /new': { name: { type: 'string', required: true } },
    };
    assert.deepEqual(diffRequests(before, after), [
      'POST /x: request field age changed type from number to string',
      'POST /x: request field note is newly required',
      'POST /new: request field name is newly required',
      'POST /x: request field gone was removed',
    ]);
    assert.deepEqual(diffRequests({ 'POST /dropped': { a: { type: 'string', required: true } } }, {}), []);
  });

  it('reports every kind together, per version, and a removed version', () => {
    const contract = { routes: ['GET /a'], requests: {}, responses: [token] };
    assert.deepEqual(diffContract(contract, contract), []);
    const read = (version, file, side) =>
      version === 'v0' && side === 'tree' ? undefined : { routes: [], requests: {}, responses: [] }[file.replace('.json', '')];
    assert.deepEqual(compareVersions(['v1', 'v0'], read), [
      'v0: the contract was removed; a version is retired, not deleted',
    ]);
    const broken = (version, file, side) =>
      ({ routes: side === 'base' ? ['GET /a'] : [], requests: {}, responses: [] })[file.replace('.json', '')];
    assert.deepEqual(compareVersions(['v1'], broken), ['v1 GET /a: route removed']);
  });
});

describe('pnpm contract:check against a release tag', () => {
  const run = (cwd, ...args) => spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });

  it('says so when there is no tag, passes an additive change and fails a break', () => {
    const repo = mkdtempSync(join(tmpdir(), 'tran-contract-'));
    try {
      git(repo, 'init', '-q');
      git(repo, 'config', 'user.email', 'test@example.com');
      git(repo, 'config', 'user.name', 'test');
      const dir = join(repo, 'fixtures/contract/v1');
      mkdirSync(dir, { recursive: true });
      const write = (routes, responses) => {
        writeFileSync(join(dir, 'routes.json'), JSON.stringify(routes));
        writeFileSync(join(dir, 'requests.json'), '{}');
        writeFileSync(join(dir, 'responses.json'), JSON.stringify(responses));
      };
      write(['POST /api/v1/auth/session'], [token]);
      git(repo, 'add', '.');
      git(repo, 'commit', '-qm', 'first');

      const untagged = run(repo);
      assert.equal(untagged.status, 0);
      assert.match(untagged.stdout, /contract: no release tag yet, so nothing to compare v1 against/);

      git(repo, 'tag', 'v0.1.0');
      write(['POST /api/v1/auth/session', 'GET /api/health'], [token, health]);
      const additive = run(repo);
      assert.equal(additive.status, 0, additive.stderr);
      assert.match(additive.stdout, /contract: v1 additive since v0\.1\.0/);
      assert.match(run(repo, '--base', 'HEAD').stdout, /contract: v1 additive since HEAD/);

      write([], []);
      const broken = run(repo);
      assert.equal(broken.status, 1);
      assert.match(broken.stderr, /✗ v1 POST \/api\/v1\/auth\/session: route removed/);
      assert.match(broken.stderr, /contract: 2 breaking change\(s\) since v0\.1\.0/);

      rmSync(dir, { recursive: true });
      mkdirSync(dir);
      assert.match(run(repo).stderr, /v1: the contract was removed/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('passes when the base has no contract yet', () => {
    const repo = mkdtempSync(join(tmpdir(), 'tran-contract-'));
    try {
      git(repo, 'init', '-q');
      git(repo, 'config', 'user.email', 'test@example.com');
      git(repo, 'config', 'user.name', 'test');
      writeFileSync(join(repo, 'README.md'), 'x');
      git(repo, 'add', '.');
      git(repo, 'commit', '-qm', 'before');
      git(repo, 'tag', 'v0.0.1');
      mkdirSync(join(repo, 'fixtures/contract/v1'), { recursive: true });
      const result = run(repo);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /contract: v0\.0\.1 has no contract snapshots/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
