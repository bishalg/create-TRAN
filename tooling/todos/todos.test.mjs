// Verifies: REQ-CODE-005
// Samples of switched-off tests are strings here; `tooling/todos/` is not scanned, so they never count.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkCredentials,
  classify,
  credentialRows,
  findSkips,
  parseMarker,
  summary,
  table,
} from './todos.mjs';

const MARK = 'TODO(credentials): APNS_KEY_ID, APNS_TOPIC - a real notification is accepted by APNs';

describe('the marker (REQ-CODE-005)', () => {
  it('REQ-CODE-005 reads the variables and what the test proves, up to a quote or the line end', () => {
    const expected = {
      variables: ['APNS_KEY_ID', 'APNS_TOPIC'],
      proves: 'a real notification is accepted by APNs',
    };
    assert.deepEqual(parseMarker(`#[ignore = "${MARK}"]`), expected);
    assert.deepEqual(parseMarker(`// ${MARK}`), expected);
    assert.deepEqual(parseMarker(`/* ${MARK} */`), expected);
    assert.deepEqual(parseMarker('TODO(credentials): ONE - x'), { variables: ['ONE'], proves: 'x' });
  });

  it('REQ-CODE-005 a marker without variables, in lower case or without what it proves is malformed', () => {
    assert.equal(parseMarker('no marker here'), null);
    for (const broken of [
      'TODO(credentials): - proves nothing',
      'TODO(credentials): apns_key - lower case',
      'TODO(credentials): APNS_KEY_ID',
      'TODO(credentials): APNS_KEY_ID -',
    ])
      assert.deepEqual(parseMarker(broken), { malformed: true }, broken);
  });
});

/** One switched-off test per dialect, as it is written in that dialect. */
const SAMPLES = [
  ['crates/x/tests/live.rs', '#[test]\n#[ignore]\nfn live() {}', 'rust'],
  ['crates/x/src/lib.rs', '    #[ignore = "slow"]\n    fn slow() {}', 'rust'],
  ['packages/a/tests/a.test.ts', "it.skip('does a thing', () => {});", 'js'],
  ['packages/a/tests/a.test.ts', "describe.skipIf(!ok)('group', () => {});", 'js'],
  ['packages/a/tests/a.test.ts', "it.todo('later');", 'js'],
  ['packages/a/tests/a.test.ts', "xit('old', () => {});", 'js'],
  ['tooling/x/x.test.mjs', "it('a', { skip: 'why' }, () => {});", 'js'],
  ['tooling/x/x.test.mjs', "test('a', { todo: true }, () => {});", 'js'],
  ['tooling/x/x.test.mjs', "it('a', (t) => { t.skip('why'); });", 'js'],
  ['e2e/smoke/a.spec.ts', "test.skip(!device, 'no device');", 'js'],
  ['e2e/steps/a.steps.ts', 'test.fixme();', 'js'],
  ['apps/ios/Tests/T/ATests.swift', 'throw XCTSkip("no Keychain")', 'swift'],
  ['apps/ios/Tests/T/ATests.swift', 'try XCTSkipIf(true, "why")', 'swift'],
  ['apps/ios/Tests/T/ATests.swift', '@Test(.disabled("why")) func a() {}', 'swift'],
  ['apps/ios/X.xcodeproj/xcshareddata/xcschemes/X.xcscheme', '            skipped = "YES"', 'xcode'],
  ['apps/ios/X.xcodeproj/xcshareddata/xcschemes/X.xcscheme', '<SkippedTests>', 'xcode'],
  ['apps/ios/X.xctestplan', '"skippedTests" : [', 'xcode'],
  ['apps/ios/project.yml', '        skippedTests: [ATests]', 'xcode'],
  ['apps/android/app/src/test/kotlin/A.kt', '@Ignore("why")\n@Test fun a() {}', 'junit'],
  ['apps/android/app/src/test/kotlin/A.kt', 'Assume.assumeTrue(false)', 'junit'],
  ['apps/android/app/src/test/kotlin/A.kt', 'assumeTrue("why", false)', 'junit'],
  ['e2e/features/a.feature', '  @skip\n  Scenario: a', 'gherkin'],
  ['e2e/features/a.feature', '  @fixme @slow\n  Scenario: a', 'gherkin'],
  ['e2e/maestro/config.yaml', 'excludeTags:\n  - slow', 'maestro'],
];

describe('finding switched-off tests (REQ-CODE-005)', () => {
  for (const [file, text, dialect] of SAMPLES)
    it(`REQ-CODE-005 finds ${dialect}: ${text.split('\n')[0].trim()}`, () => {
      const skips = findSkips(file, text);
      assert.equal(skips.length, 1, JSON.stringify(skips));
      assert.equal(skips[0].dialect, dialect);
      assert.equal(skips[0].marker, null);
    });

  it('REQ-CODE-005 leaves alone what only looks like a skip', () => {
    for (const [file, text] of [
      ['packages/a/tests/a.test.ts', 'function list(dir: string, skip: RegExp) {}'],
      ['packages/a/tests/a.test.ts', '// it.skip is not used here'],
      ['apps/ios/Sources/App/Button.swift', '.disabled(!isEnabled)'],
      ['apps/ios/X.xcscheme', 'skipped = "NO"'],
      ['apps/api/src/main.rs', 'let args = std::env::args().skip(1);'],
      ['crates/x/src/lib.rs', '// #[ignore] would hide it'],
      ['e2e/features/a.feature', '  # @skip in a comment'],
      ['apps/android/app/src/test/kotlin/A.kt', 'import org.junit.Assume.assumeTrue'],
      ['docs/TESTING.md', 'it.skip("x")'],
      ['tooling/todos/todos.test.mjs', "it.skip('sample')"],
    ])
      assert.deepEqual(findSkips(file, text), [], `${file}: ${text}`);
  });

  it('REQ-CODE-005 reads the marker from the skip itself or from the comment block above it', () => {
    const inline = findSkips('apps/api/tests/live.rs', `#[ignore = "${MARK}"]`);
    assert.deepEqual(inline[0].marker.variables, ['APNS_KEY_ID', 'APNS_TOPIC']);
    const above = findSkips(
      'packages/a/tests/a.test.ts',
      `// Sends for real.\n// ${MARK}\nit.skip('sends', () => {});`
    );
    assert.equal(above[0].marker.proves, 'a real notification is accepted by APNs');
    const spread = findSkips(
      'e2e/smoke/a.spec.ts',
      `test.skip(\n  !process.env.APNS_KEY_ID,\n  '${MARK}'\n);`
    );
    assert.equal(spread[0].marker.variables.length, 2);
    const kotlin = findSkips('apps/android/app/src/androidTest/kotlin/A.kt', `@Ignore("${MARK}")`);
    assert.equal(kotlin[0].marker.variables[0], 'APNS_KEY_ID');
    const away = findSkips('packages/a/tests/a.test.ts', `// ${MARK}\n\nit.skip('x', () => {});`);
    assert.equal(away[0].marker, null, 'a blank line ends the comment block');
  });
});

const skip = (file, line, marker = null) => ({ file, line, dialect: 'js', marker });
const gatedMarker = { variables: ['APNS_KEY_ID'], proves: 'it sends' };

describe('classifying (REQ-CODE-005)', () => {
  it('REQ-CODE-005 a marked skip is credential-gated; an unmarked one fails without an allowlist entry', () => {
    const { gated, problems } = classify([skip('a.test.ts', 3, gatedMarker), skip('b.test.ts', 7)], []);
    assert.deepEqual(gated, [{ variables: ['APNS_KEY_ID'], proves: 'it sends', file: 'a.test.ts', line: 3 }]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^b\.test\.ts:7: a js test is switched off without TODO\(credentials\)/);
  });

  it('REQ-CODE-005 a malformed marker is a problem, not a pass', () => {
    const { gated, problems } = classify([skip('a.test.ts', 1, { malformed: true })], []);
    assert.deepEqual(gated, []);
    assert.match(problems[0], /a\.test\.ts:1: malformed marker/);
  });

  it('REQ-CODE-005 an allowlist entry covers exactly its count of unmarked skips, with a reason', () => {
    const skips = [skip('e2e/a.spec.ts', 1), skip('e2e/a.spec.ts', 2)];
    const ok = classify(skips, [{ file: 'e2e/a.spec.ts', count: 2, reason: 'no emulator' }]);
    assert.deepEqual(ok.problems, []);
    const more = classify(skips, [{ file: 'e2e/a.spec.ts', count: 1, reason: 'no emulator' }]);
    assert.match(more.problems[0], /allows 1 skip\(s\) but the file has 2/);
    const silent = classify(skips, [{ file: 'e2e/a.spec.ts', count: 2, reason: ' ' }]);
    assert.match(silent.problems[0], /has no reason/);
    const stale = classify([], [{ file: 'e2e/gone.spec.ts', count: 1, reason: 'old' }]);
    assert.match(stale.problems[0], /matches nothing any more; remove it/);
  });
});

const CREDENTIALS = `# Credentials

| Feature | Variables | Spec | Gate |
| :------ | :-------- | :--- | :--- |
| Push to iOS | \`APNS_KEY_ID\`, \`APNS_TOPIC\` | 027 | skipped tests: \`push_live_test.rs\` |
| iOS upload | \`TRAN_ASC_KEY_ID\` | 025 | \`pnpm ios:lane doctor\` |

Other text | with a pipe.
`;

describe('the credentials table (REQ-CODE-005)', () => {
  it('REQ-CODE-005 reads each row of the first table by its header', () => {
    assert.deepEqual(credentialRows(CREDENTIALS), [
      { feature: 'Push to iOS', variables: ['APNS_KEY_ID', 'APNS_TOPIC'], gate: 'skipped tests: `push_live_test.rs`' },
      { feature: 'iOS upload', variables: ['TRAN_ASC_KEY_ID'], gate: '`pnpm ios:lane doctor`' },
    ]);
    assert.deepEqual(credentialRows('no table'), []);
    assert.equal(credentialRows('| Feature | Variables |\n| - | - |\n| a | `X` |')[0].gate, '');
  });

  const rows = credentialRows(CREDENTIALS);
  const required = { ios: ['TRAN_ASC_KEY_ID'], android: [] };
  const gated = [{ variables: ['APNS_KEY_ID', 'APNS_TOPIC'], proves: 'x', file: 'f', line: 1 }];
  const env = ['APNS_KEY_ID', 'APNS_TOPIC', 'TRAN_ASC_KEY_ID'];

  it('REQ-CODE-005 agrees when every marker variable is documented and every row is backed', () => {
    assert.deepEqual(checkCredentials(gated, env, rows, required), []);
  });

  it('REQ-CODE-005 a marker variable missing from .env.example or from the table fails', () => {
    const extra = [{ ...gated[0], variables: ['APNS_KEY_ID', 'NEW_SECRET'] }];
    assert.deepEqual(checkCredentials(extra, env, rows, required), [
      'NEW_SECRET is named by a TODO(credentials) marker but missing from .env.example',
      'NEW_SECRET is named by a TODO(credentials) marker but in no row of docs/CREDENTIALS.md',
    ]);
  });

  it('REQ-CODE-005 a row without a marker, a doctor that does not check it, or no gate fails', () => {
    assert.deepEqual(checkCredentials([], env, rows, required), [
      'docs/CREDENTIALS.md "Push to iOS": no TODO(credentials) marker names its variables',
    ]);
    assert.deepEqual(checkCredentials(gated, env, rows, { ios: [] }), [
      'docs/CREDENTIALS.md "iOS upload": TRAN_ASC_KEY_ID is not checked by pnpm ios:lane doctor',
    ]);
    const ungated = [{ feature: 'Purchases', variables: ['X'], gate: 'later' }];
    assert.match(checkCredentials([], env, ungated, required)[0], /its Gate must name the skipped tests/);
  });
});

describe('output (REQ-CODE-005)', () => {
  it('REQ-CODE-005 lists every credential-gated test and never says only "ok"', () => {
    const gated = [
      { variables: ['B'], proves: 'b works', file: 'z.rs', line: 2 },
      { variables: ['A', 'C'], proves: 'a works', file: 'a.rs', line: 9 },
    ];
    assert.equal(
      table(gated),
      [
        '| Test | Variables | What it proves |',
        '| :--- | :--- | :--- |',
        '| `a.rs:9` | `A`, `C` | a works |',
        '| `z.rs:2` | `B` | b works |',
      ].join('\n')
    );
    assert.equal(
      summary(gated, [{ count: 6 }, { count: 1 }]),
      'todos: ok (2 test(s) switched off until credentials are set, 7 skipped for a reason in tooling/todos/allow.json, such as a missing device; --list shows the first kind)'
    );
  });
});
