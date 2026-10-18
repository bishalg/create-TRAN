import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkSpecs, parseRequirements } from './spec-check.mjs';

const spec = `
# Spec

### REQ-RULE-001 [verified] Rust is the source of truth
Text.

### REQ-RULE-002 [planned] Something later
Text.

### REQ-RULE-003 Missing status defaults to verified
`;

describe('parseRequirements', () => {
  it('reads id, status and title from level-3 headings', () => {
    assert.deepEqual(parseRequirements(spec, 'docs/specs/001.md'), [
      {
        id: 'REQ-RULE-001',
        status: 'verified',
        title: 'Rust is the source of truth',
        file: 'docs/specs/001.md',
      },
      {
        id: 'REQ-RULE-002',
        status: 'planned',
        title: 'Something later',
        file: 'docs/specs/001.md',
      },
      {
        id: 'REQ-RULE-003',
        status: 'verified',
        title: 'Missing status defaults to verified',
        file: 'docs/specs/001.md',
      },
    ]);
  });

  it('ignores ids that are only mentioned in prose', () => {
    assert.deepEqual(parseRequirements('See REQ-RULE-001 above.', 'x.md'), []);
  });
});

describe('checkSpecs', () => {
  const reqs = parseRequirements(spec, 'a.md');

  it('passes when every verified requirement is cited and nothing unknown is cited', () => {
    const result = checkSpecs(reqs, [
      { file: 't.test.ts', text: "it('[REQ-RULE-001] works')\n// REQ-RULE-003" },
    ]);
    assert.deepEqual(result, { uncovered: [], unknown: [], ok: true });
  });

  it('reports verified requirements that no test cites', () => {
    const result = checkSpecs(reqs, [{ file: 't.ts', text: 'REQ-RULE-001' }]);
    assert.deepEqual(
      result.uncovered.map((r) => r.id),
      ['REQ-RULE-003']
    );
    assert.equal(result.ok, false);
  });

  it('does not require planned requirements to be cited', () => {
    const result = checkSpecs(reqs, [{ file: 't.ts', text: 'REQ-RULE-001 REQ-RULE-003' }]);
    assert.equal(result.ok, true);
  });

  it('reports ids cited by tests that no spec defines (typos, deleted requirements)', () => {
    const result = checkSpecs(reqs, [
      { file: 't.ts', text: 'REQ-RULE-001 REQ-RULE-003 REQ-NOPE-009' },
    ]);
    assert.deepEqual(result.unknown, [{ id: 'REQ-NOPE-009', file: 't.ts' }]);
    assert.equal(result.ok, false);
  });
});
