import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { measureDebt } from './debt-metrics.mjs';

// Verifies: REQ-CODE-003
describe('debt ratchet (T3)', () => {
  it('counts as unknown as', () => {
    const text = 'const x = val as unknown as string;';
    const debt = measureDebt(text);
    assert.equal(debt.asUnknownAs, 1);
  });

  it('counts eslint-disable', () => {
    const text = '// eslint-disable-next-line @typescript-eslint/no-explicit-any';
    const debt = measureDebt(text);
    assert.equal(debt.eslintDisable, 1);
  });

  it('counts #[allow(', () => {
    const text = '#[allow(clippy::too_many_arguments)]';
    const debt = measureDebt(text);
    assert.equal(debt.allowAttr, 1);
  });
});
