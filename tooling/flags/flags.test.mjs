// Verifies: REQ-CFG-009 REQ-CFG-010
// Every case runs on a temporary repository and a fixed date: these tests must not turn red on
// the day a real flag expires (the gate itself must, REQ-CFG-009), nor depend on what the real
// apps read today.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  checkFlagExpiry,
  checkFlagUsage,
  checkRuleFiles,
  isSafeFlagId,
  parseArgs,
  runChecks,
} from './flags.mjs';

const TODAY = new Date('2026-11-11T00:00:00Z');
const NOTIFY_ME = { id: 'notify_me', expiry: '2027-01-01' };

/** A throwaway repository holding `files` (path → content). */
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'tran-flags-'));
  const all = {
    'fixtures/flags.json': JSON.stringify({ flags: [NOTIFY_ME] }),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  test.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const READER = { 'apps/web/src/Reminder.tsx': 'export const show = (c) => c.flags.notifyMe;\n' };

test('isSafeFlagId rejects secret-like, empty, or oversized names (REQ-CFG-010)', () => {
  assert.equal(isSafeFlagId('notify_me'), true);
  assert.equal(isSafeFlagId('dark_mode_enabled'), true);
  assert.equal(isSafeFlagId(''), false);
  assert.equal(isSafeFlagId('a'.repeat(65)), false);
  for (const id of ['auth_token', 'api_key', 'secret_feature', 'private_key', 'user_password']) {
    assert.equal(isSafeFlagId(id), false, id);
  }
});

test('checkFlagExpiry: the reference date is injected (REQ-CFG-009)', () => {
  assert.equal(checkFlagExpiry(NOTIFY_ME, TODAY), null);
  assert.equal(checkFlagExpiry(NOTIFY_ME, new Date('2027-01-01T00:00:00Z')), null);
  assert.match(
    checkFlagExpiry(NOTIFY_ME, new Date('2027-01-02T00:00:00Z')),
    /expired on 2027-01-01/
  );
  assert.match(checkFlagExpiry({ id: 'x', expiry: 'soon' }, TODAY), /invalid expiry date/);
});

test('a clean repository passes (REQ-CFG-009)', () => {
  assert.deepEqual(runChecks({ rootDir: repo(READER), referenceDate: TODAY }), []);
});

test('an expired flag fails on the day after its expiry (REQ-CFG-009)', () => {
  const problems = runChecks({ rootDir: repo(READER), referenceDate: new Date('2027-01-02') });
  assert.deepEqual(problems, ['Flag "notify_me" expired on 2027-01-01']);
});

test('the generated accessor counts as a read, on every platform (REQ-CFG-009)', () => {
  for (const [path, code] of [
    ['apps/web/src/a.ts', 'const on = store.flags.notifyMe;'],
    ['packages/core-ts/src/b.ts', 'if (FLAGS.notifyMe.get(values)) show();'],
    ['apps/ios/Sources/App/C.swift', 'let on = Flags.notifyMe(from: values)'],
    ['apps/android/app/src/main/kotlin/D.kt', 'val on = Flags.notifyMe(values)'],
  ]) {
    assert.equal(checkFlagUsage(NOTIFY_ME, repo({ [path]: code })), true, path);
  }
});

test('a flag named only in tests, comments, generated code or by its raw id is unused (REQ-CFG-009)', () => {
  const root = repo({
    'apps/web/src/a.test.tsx': 'expect(store.flags.notifyMe).toBe(true);',
    'apps/web/tests/b.ts': 'store.flags.notifyMe;',
    'apps/web/src/c.ts':
      '// store.flags.notifyMe\n/* Flags.notifyMe(x) */\nconst id = "notify_me";',
    'apps/web/src/d.ts': 'ids.notifyMeButton; const k = NOTIFY_ME_ID; FLAGS.notifyMeId;',
    'packages/core-ts/src/generated/flags.ts': 'notifyMe: FLAGS.notifyMe.get(latest),',
    'apps/ios/Sources/App/Generated/Flags.swift': 'Flags.notifyMe(from: x)',
    'apps/ios/Tests/AppTests/E.swift': 'Flags.notifyMe(from: x)',
    'apps/android/app/src/test/kotlin/F.kt': 'Flags.notifyMe(x)',
    'apps/android/app/src/main/kotlin/G.kt': '/** @generated */\nFlags.notifyMe(x)',
  });
  assert.equal(checkFlagUsage(NOTIFY_ME, root), false);
  assert.deepEqual(runChecks({ rootDir: root, referenceDate: TODAY }), [
    'Declared flag "notify_me" is read by no client (REQ-CFG-009)',
  ]);
});

test('a rule file naming an undeclared flag fails; other JSON is not a rule file (REQ-CFG-009)', () => {
  const root = repo({
    ...READER,
    'deploy/flags.json': JSON.stringify({ flags: { notify_me: [{ value: true }], ghost: [] } }),
    'apps/targeting/rules.json': JSON.stringify({ flags: { phantom: [{ value: 1 }] } }),
    'fixtures/stored.json': JSON.stringify({ flags: { future_flag: true } }),
    'broken.json': '{ not json',
  });
  assert.deepEqual(checkRuleFiles(new Set(['notify_me']), root).sort(), [
    'Rule file "apps/targeting/rules.json" names unknown flag "phantom"',
    'Rule file "deploy/flags.json" names unknown flag "ghost"',
  ]);
});

test('build output, dependencies and coverage are never read as rule files (REQ-CFG-009)', () => {
  const ghost = JSON.stringify({ flags: { ghost: [] } });
  const root = repo({
    ...READER,
    'node_modules/pkg/flags.json': ghost,
    'target/debug/flags.json': ghost,
    'apps/web/dist/flags.json': ghost,
    'apps/android/app/build/flags.json': ghost,
    'coverage/flags.json': ghost,
  });
  assert.deepEqual(checkRuleFiles(new Set(['notify_me']), root), []);
});

test('a secret-like flag and a missing catalogue are reported (REQ-CFG-010)', () => {
  const root = repo({
    'fixtures/flags.json': JSON.stringify({ flags: [{ id: 'api_key', expiry: '2030-01-01' }] }),
    'apps/web/src/a.ts': 'flags.apiKey;',
  });
  assert.deepEqual(runChecks({ rootDir: root, referenceDate: TODAY }), [
    'Flag "api_key" looks like a secret (REQ-CFG-010)',
  ]);
  const empty = mkdtempSync(join(tmpdir(), 'tran-flags-empty-'));
  test.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.match(runChecks({ rootDir: empty })[0], /Flags fixture not found/);
});

test('parseArgs reads --root and --today', () => {
  assert.deepEqual(parseArgs([]), {});
  const args = parseArgs(['--root', '/r', '--today', '2026-11-11']);
  assert.equal(args.rootDir, '/r');
  assert.equal(args.referenceDate.toISOString(), '2026-11-11T00:00:00.000Z');
  assert.throws(() => parseArgs(['--today', 'tomorrow']), /--today/);
  assert.throws(() => parseArgs(['--colour']), /unknown argument/);
});
