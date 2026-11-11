// Verifies: REQ-VER-002, REQ-CON-011
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  compareOpenapi,
  compareVersions,
  diffContract,
  diffRequests,
  diffResponses,
  diffRoutes,
  shapeOf,
  typeOf,
} from './contract.mjs';
import { diffOpenapi, flatten, operations } from './openapi-diff.mjs';

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
    assert.deepEqual(
      [...shape.keys()],
      ['components', 'components[]', 'components[].name', 'components[].healthy']
    );
    assert.deepEqual([...shape.get('components[].healthy')], ['boolean']);
    assert.equal(typeOf(null), 'null');
    assert.equal(typeOf([]), 'array');
    assert.equal(shapeOf(null).size, 0);
  });
});

describe('diffResponses (REQ-VER-002)', () => {
  it('allows a new field, a new route and a new error', () => {
    const grown = {
      ...token,
      body: { ...token.body, scope: 'vote', user: { ...token.body.user, team: 'n' } },
    };
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
    const other = {
      ...health,
      body: { components: [{ name: 'axum', healthy: false, uptime: 1 }] },
    };
    assert.deepEqual(diffResponses([health, other], [other]), []);
  });
});

describe('diffRoutes and diffRequests (REQ-VER-002)', () => {
  it('fails on a removed route only', () => {
    assert.deepEqual(diffRoutes(['GET /a', 'GET /b'], ['GET /b', 'GET /c']), [
      'GET /a: route removed',
    ]);
  });

  it('fails on a newly required, a retyped or a removed request field', () => {
    const before = {
      'POST /x': {
        age: { type: 'number', required: true },
        note: { type: 'string', required: false },
        gone: { type: 'string', required: false },
      },
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
    assert.deepEqual(
      diffRequests({ 'POST /dropped': { a: { type: 'string', required: true } } }, {}),
      []
    );
  });

  it('reports every kind together, per version, and a removed version', () => {
    const contract = { routes: ['GET /a'], requests: {}, responses: [token] };
    assert.deepEqual(diffContract(contract, contract), []);
    const read = (version, file, side) =>
      version === 'v0' && side === 'tree'
        ? undefined
        : { routes: [], requests: {}, responses: [] }[file.replace('.json', '')];
    assert.deepEqual(compareVersions(['v1', 'v0'], read), [
      'v0: the contract was removed; a version is retired, not deleted',
    ]);
    const broken = (version, file, side) =>
      ({ routes: side === 'base' ? ['GET /a'] : [], requests: {}, responses: [] })[
        file.replace('.json', '')
      ];
    assert.deepEqual(compareVersions(['v1'], broken), ['v1 GET /a: route removed']);
  });
});

// An OpenAPI document with one operation, `POST /vote`, built from small pieces.
const doc = ({ request, response, headers = [], security, extra = {}, schemas = {} } = {}) => ({
  openapi: '3.1.0',
  info: { title: 't', version: '1' },
  components: { schemas },
  paths: {
    '/vote': {
      post: {
        parameters: headers,
        ...(security ? { security } : {}),
        requestBody: {
          required: true,
          content: { 'application/json': { schema: request ?? { type: 'object' } } },
        },
        responses: {
          200: {
            description: 'ok',
            content: { 'application/json': { schema: response ?? { type: 'object' } } },
          },
          default: { description: 'error' },
        },
      },
      ...extra,
    },
  },
});
const object = (properties, required = [], more = {}) => ({
  type: 'object',
  properties,
  required,
  ...more,
});
const reqDoc = (properties, required, more) => doc({ request: object(properties, required, more) });
const resDoc = (properties, required) => doc({ response: object(properties, required) });
const header = (name, required) => ({ name, in: 'header', required, schema: { type: 'string' } });

describe('diffOpenapi (REQ-CON-011)', () => {
  const op = 'POST /vote';
  const fails = (before, after, expected) => assert.deepEqual(diffOpenapi(before, after), expected);

  it('REQ-CON-011 fails on an operation removed', () => {
    fails(doc(), { ...doc(), paths: {} }, [`${op}: operation removed`]);
  });

  it('REQ-CON-011 fails on authentication added to an operation', () => {
    fails(doc(), doc({ security: [{ bearer: [] }] }), [`${op}: authentication was added`]);
    fails(doc({ security: [{ bearer: [] }] }), doc({ security: [{ bearer: [] }] }), []);
    const global = { ...doc(), security: [{ bearer: [] }] };
    fails(global, doc({ security: [{ bearer: [] }] }), []);
    fails(doc(), global, [`${op}: authentication was added`]);
  });

  it('REQ-CON-011 fails on a request header added or made required', () => {
    fails(doc(), doc({ headers: [header('Idempotency-Key', true)] }), [
      `${op}: request header Idempotency-Key is newly required`,
    ]);
    fails(doc({ headers: [header('X-A', false)] }), doc({ headers: [header('x-a', true)] }), [
      `${op}: request header x-a is now required`,
    ]);
  });

  it('REQ-CON-011 allows an optional request header and ignores a path parameter', () => {
    fails(
      doc(),
      doc({ headers: [header('X-A', false), { name: 'id', in: 'path', required: true }] }),
      []
    );
  });

  it('REQ-CON-011 fails on a request field removed, added as required or made required', () => {
    const before = reqDoc({ a: { type: 'string' }, b: { type: 'string' } }, []);
    fails(before, reqDoc({ b: { type: 'string' } }, []), [`${op}: request field a was removed`]);
    fails(
      before,
      reqDoc({ a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } }, ['c']),
      [`${op}: request field c was added as required`]
    );
    fails(before, reqDoc({ a: { type: 'string' }, b: { type: 'string' } }, ['a']), [
      `${op}: request field a is now required`,
    ]);
  });

  it('REQ-CON-011 allows a new optional request field, nested too', () => {
    const before = reqDoc({ a: object({ x: { type: 'string' } }) }, []);
    fails(
      before,
      reqDoc(
        { a: object({ x: { type: 'string' }, y: { type: 'string' } }), n: { type: 'string' } },
        []
      ),
      []
    );
  });

  it('REQ-CON-011 fails on a request field type change', () => {
    fails(reqDoc({ a: { type: 'string' } }), reqDoc({ a: { type: 'integer' } }), [
      `${op}: request field a changed type from string to integer`,
    ]);
  });

  it('REQ-CON-011 fails on a closed-enum value removed but not on one added', () => {
    const e = (values) => reqDoc({ a: { type: 'string', enum: values } });
    fails(e(['x', 'y']), e(['x']), [`${op}: request field a no longer accepts "y"`]);
    fails(e(['x']), e(['x', 'y']), []);
  });

  it('REQ-CON-011 fails on a bound narrowed', () => {
    const n = (more) => reqDoc({ a: { type: 'integer', ...more } });
    fails(n({ minimum: 1, maximum: 10 }), n({ minimum: 2, maximum: 9 }), [
      `${op}: request field a minimum narrowed from 1 to 2`,
      `${op}: request field a maximum narrowed from 10 to 9`,
    ]);
    fails(n({}), n({ maximum: 5 }), [
      `${op}: request field a maximum narrowed from unbounded to 5`,
    ]);
    fails(n({ minimum: 2, maximum: 9 }), n({ minimum: 1, maximum: 10 }), []);
    const s = (more) => reqDoc({ a: { type: 'string', ...more } });
    fails(s({ minLength: 1 }), s({ minLength: 3 }), [
      `${op}: request field a minLength narrowed from 1 to 3`,
    ]);
  });

  it('REQ-CON-011 fails on a request format added or changed', () => {
    const f = (format) => reqDoc({ a: { type: 'string', ...(format ? { format } : {}) } });
    fails(f(), f('uuid'), [`${op}: request field a format uuid was added`]);
    fails(f('uuid'), f('date-time'), [
      `${op}: request field a format changed from uuid to date-time`,
    ]);
    fails(f('uuid'), f(), []);
  });

  it('REQ-CON-011 fails on a request shape made closed', () => {
    fails(
      reqDoc({ a: object({}) }),
      reqDoc({ a: object({}, [], { additionalProperties: false }) }),
      [`${op}: request field a shape was made closed (additionalProperties: false)`]
    );
    fails(reqDoc({}), reqDoc({}, [], { additionalProperties: false }), [
      `${op}: request field body shape was made closed (additionalProperties: false)`,
    ]);
  });

  it('REQ-CON-011 fails on a response field removed', () => {
    fails(
      resDoc({ a: { type: 'string' }, b: { type: 'string' } }),
      resDoc({ a: { type: 'string' } }),
      [`${op} 200: response field b was removed`]
    );
  });

  it('REQ-CON-011 fails on a required response field made optional or nullable', () => {
    const a = { type: 'string' };
    fails(resDoc({ a }, ['a']), resDoc({ a }, []), [
      `${op} 200: response field a was made optional`,
    ]);
    fails(resDoc({ a }, ['a']), resDoc({ a: { type: ['string', 'null'] } }, ['a']), [
      `${op} 200: response field a was made nullable`,
    ]);
  });

  it('REQ-CON-011 fails on a response type, format or constant change', () => {
    const r = (more) => resDoc({ a: { type: 'string', ...more } }, ['a']);
    fails(r(), resDoc({ a: { type: 'integer' } }, ['a']), [
      `${op} 200: response field a changed type from string to integer`,
    ]);
    fails(r({ format: 'uuid' }), r({ format: 'date-time' }), [
      `${op} 200: response field a changed format from uuid to date-time`,
    ]);
    fails(r({ const: 'x' }), r({ const: 'y' }), [
      `${op} 200: response field a changed constant from "x" to "y"`,
    ]);
    fails(r({ const: 'x' }), r(), [
      `${op} 200: response field a changed constant from "x" to undefined`,
    ]);
  });

  it('REQ-CON-011 fails when a success status is no longer answered', () => {
    const gone = doc();
    delete gone.paths['/vote'].post.responses[200];
    fails(doc(), gone, [`${op} 200: no longer answered`]);
    fails(gone, doc(), []);
  });

  it('REQ-CON-011 allows a new operation, response field, status and wire-enum value', () => {
    const wire = (values) => ({
      type: 'string',
      'x-tran-wire-enum': { values, fallback: 'unknown' },
    });
    const before = doc({ response: object({ a: wire(['x']) }, ['a']) });
    const after = doc({
      response: object({ a: wire(['x', 'y']), b: { type: 'string' } }, ['a']),
      extra: { '/other': { get: { responses: { 200: { description: 'ok' } } } } },
    });
    after.paths['/vote'].post.responses[202] = { description: 'accepted' };
    fails(before, after, []);
  });

  it('REQ-CON-011 resolves $ref, allOf and arrays, maps and cycles', () => {
    const schemas = {
      Node: object({ name: { type: 'string' }, next: { $ref: '#/components/schemas/Node' } }, [
        'name',
      ]),
      Base: object({ id: { type: 'string' } }, ['id']),
    };
    const d = doc({
      schemas,
      response: object(
        {
          list: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
          map: { type: 'object', additionalProperties: { type: 'integer' } },
          both: {
            allOf: [
              { $ref: '#/components/schemas/Base' },
              object({ more: { type: 'string' } }, ['more']),
            ],
          },
        },
        ['list']
      ),
    });
    const fields = operations(d).get('POST /vote').responses.get('200');
    assert.deepEqual(
      [...fields.keys()],
      [
        '',
        'list',
        'list[]',
        'list[].name',
        'list[].next',
        'map',
        'map.*',
        'both',
        'both.id',
        'both.more',
      ]
    );
    assert.equal(fields.get('both.id').required, true);
    assert.equal(fields.get('list').required, true);
    assert.equal(fields.get('list[].next').type, 'object');
    fails(d, { ...d, components: { schemas: { ...schemas, Base: object({}) } } }, [
      `${op} 200: response field both.id was removed`,
    ]);
    assert.throws(() => flatten(d, { $ref: '#/components/schemas/Nope' }), /unresolved \$ref/);
    assert.throws(() => flatten(d, { $ref: 'other.json#/x' }), /only local \$ref/);
  });

  it('REQ-CON-011 reads parameters and bodies by $ref and path-level parameters', () => {
    const d = doc({ extra: { parameters: [{ $ref: '#/components/parameters/Key' }] } });
    d.components.parameters = { Key: header('Idempotency-Key', true) };
    d.paths['/vote'].post.requestBody = { $ref: '#/components/requestBodies/Vote' };
    d.components.requestBodies = {
      Vote: {
        required: true,
        content: { 'application/json': { schema: object({ a: { type: 'string' } }) } },
      },
    };
    const found = operations(d).get('POST /vote');
    assert.equal(found.headers.get('idempotency-key').required, true);
    assert.deepEqual([...found.request.keys()], ['', 'a']);
  });
});

describe('compareOpenapi (REQ-CON-011)', () => {
  it('REQ-CON-011 skips a base without openapi.json, fails a tree without it, and prefixes the version', () => {
    const said = [];
    const run = (base, tree) =>
      compareOpenapi(
        ['v1'],
        (_version, side) => (side === 'base' ? base : tree),
        (line) => said.push(line)
      );
    assert.deepEqual(run(undefined, doc()), []);
    assert.deepEqual(said, ['contract: v1/openapi.json is not at the base, so it is skipped']);
    assert.deepEqual(run(doc(), undefined), [
      'v1 openapi.json: removed; a version is retired, not deleted',
    ]);
    assert.deepEqual(run(doc(), { ...doc(), paths: {} }), [
      'v1 openapi.json POST /vote: operation removed',
    ]);
    assert.deepEqual(run(doc(), doc()), []);
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
      assert.match(
        untagged.stdout,
        /contract: no release tag yet, so nothing to compare v1 against/
      );

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
