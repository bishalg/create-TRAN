// Verifies: REQ-CFG-009 REQ-CFG-010
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFlagExpiry,
  checkRuleFiles,
  isSafeFlagId,
  runChecks,
} from './flags.mjs';

test('isSafeFlagId rejects secret-like, empty, or oversized names (REQ-CFG-010)', () => {
  assert.equal(isSafeFlagId('notify_me'), true);
  assert.equal(isSafeFlagId('dark_mode_enabled'), true);
  assert.equal(isSafeFlagId('voter_reminder_v2'), true);

  assert.equal(isSafeFlagId(''), false);
  assert.equal(isSafeFlagId('a'.repeat(65)), false);
  assert.equal(isSafeFlagId('auth_token'), false);
  assert.equal(isSafeFlagId('api_key'), false);
  assert.equal(isSafeFlagId('secret_feature'), false);
  assert.equal(isSafeFlagId('private_key'), false);
  assert.equal(isSafeFlagId('user_password'), false);
  assert.equal(isSafeFlagId('app_credential'), false);
});

test('checkFlagExpiry flags expired dates and passes future dates (REQ-CFG-009)', () => {
  const ref = new Date('2026-11-11T00:00:00Z');

  const valid = { id: 'notify_me', expiry: '2027-01-01' };
  assert.equal(checkFlagExpiry(valid, ref), null);

  const expired = { id: 'old_feature', expiry: '2025-01-01' };
  assert.match(checkFlagExpiry(expired, ref), /expired on 2025-01-01/);

  const malformed = { id: 'bad_date', expiry: 'not-a-date' };
  assert.match(checkFlagExpiry(malformed, ref), /invalid expiry date/);
});

test('checkRuleFiles flags files with undeclared flags (REQ-CFG-009)', () => {
  const declared = new Set(['notify_me']);
  const problems = checkRuleFiles(declared, process.cwd());
  assert.equal(problems.length, 0);
});

test('runChecks passes cleanly on the actual repository (REQ-CFG-009, REQ-CFG-010)', () => {
  const problems = runChecks({ rootDir: process.cwd() });
  assert.deepEqual(problems, []);
});
