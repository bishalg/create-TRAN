import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scanSource, PATTERNS } from './fallback-gate.mjs';

// Verifies: REQ-CODE-001
describe('fallback-gate (T1)', () => {
  it('catches zero fallbacks on latitude/longitude/age', () => {
    const code = 'const targetLat = latitude ?? 0;';
    const violations = scanSource('src/test.ts', code);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].patternId, 'zero-fallback-variable');
  });

  it('catches literal timezone fallbacks', () => {
    const code = 'const tz = "Asia/Kathmandu";';
    const violations = scanSource('src/test.ts', code);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].patternId, 'literal-timezone');
  });

  it('catches unwrap_or_default in crates/rust-core/src', () => {
    const code = 'let val = input.unwrap_or_default();';
    const violations = scanSource('crates/rust-core/src/rules.rs', code);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].patternId, 'rust-rule-unwrap-default');
  });

  it('respects allowlist', () => {
    const code = 'const lat = latitude ?? 0;';
    const allow = { 'src/test.ts': ['zero-fallback-variable'] };
    const violations = scanSource('src/test.ts', code, allow);
    assert.equal(violations.length, 0);
  });
});
