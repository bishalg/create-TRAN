// Verifies: REQ-AGT-003
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateSignal,
  plannedRequirements,
  survivingMutants,
  truncate,
  untranslatedStrings,
} from './agents.mjs';

describe('signals (REQ-AGT-003)', () => {
  it('exit 0 is no signal, 126/127/killed is broken, anything else is work', () => {
    assert.equal(evaluateSignal({ status: 0, output: 'fine' }, 10).kind, 'none');
    assert.equal(evaluateSignal({ status: 1, output: 'found' }, 10).kind, 'work');
    assert.equal(evaluateSignal({ status: 3, output: 'found' }, 10).kind, 'work');
    for (const status of [126, 127, null])
      assert.equal(evaluateSignal({ status, output: '' }, 10).kind, 'broken');
  });

  it('truncates evidence to the line budget and says so', () => {
    const text = Array.from({ length: 5 }, (_, i) => `line ${i}`).join('\n');
    assert.equal(truncate(text, 5), text);
    assert.equal(truncate(`${text}\n\n`, 5), text);
    assert.equal(
      truncate(text, 2),
      'line 0\nline 1\n… 3 more lines cut (raise "evidence_lines" to see them)'
    );
  });

  it('planned requirements are work; none is no signal', () => {
    const reqs = [
      { id: 'REQ-X-1', status: 'verified', title: 'Done', file: 'a.md' },
      { id: 'REQ-X-2', status: 'planned', title: 'Next', file: 'a.md' },
    ];
    assert.deepEqual(plannedRequirements(reqs), {
      status: 1,
      output: 'REQ-X-2 [planned] Next (a.md)',
    });
    assert.equal(plannedRequirements(reqs.slice(0, 1)).status, 0);
  });

  it('a string identical to English is untranslated unless allowed', () => {
    const dictionaries = {
      en: { 'common.brand': 'TRAN', 'common.save': 'Save', 'common.yes': 'Yes' },
      ne: { 'common.brand': 'TRAN', 'common.save': 'Save', 'common.yes': 'हो' },
      hi: { 'common.brand': 'TRAN', 'common.save': 'सहेजें', 'common.yes': 'हाँ' },
    };
    assert.deepEqual(untranslatedStrings(dictionaries, ['common.brand']), {
      status: 1,
      output: 'ne common.save: "Save"',
    });
    assert.equal(untranslatedStrings({ en: { a: 'x' }, ne: { a: 'य' } }).status, 0);
  });

  it('surviving mutants from either tool are work; no report is no signal, with a hint', () => {
    const strykerJson = {
      files: {
        'src/a.ts': {
          mutants: [
            { status: 'Killed', location: { start: { line: 1 } }, mutatorName: 'X' },
            {
              status: 'Survived',
              location: { start: { line: 7 } },
              mutatorName: 'EqualityOperator',
              replacement: 'a <= b',
            },
            { status: 'Survived', location: { start: { line: 9 } }, mutatorName: 'BlockStatement' },
          ],
        },
        'src/b.ts': {},
      },
    };
    assert.deepEqual(
      survivingMutants({
        cargoMissed: 'crates/x/src/lib.rs:3: replace > with >=\n',
        strykerJson,
        strykerRoot: 'packages/core-ts/',
      }),
      {
        status: 1,
        output:
          'rust: crates/x/src/lib.rs:3: replace > with >=\nts: packages/core-ts/src/a.ts:7: EqualityOperator → "a <= b"\nts: packages/core-ts/src/a.ts:9: BlockStatement → ""',
      }
    );
    assert.match(survivingMutants({}).output, /no mutation report/);
    assert.deepEqual(survivingMutants({ cargoMissed: '' }), {
      status: 0,
      output: 'no surviving mutants',
    });
  });
});
