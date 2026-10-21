// Verifies: REQ-AGT-001, REQ-AGT-002, REQ-AGT-003, REQ-AGT-004, REQ-AGT-005, REQ-AGT-006, REQ-AGT-007, REQ-AGT-008, REQ-AGT-009
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  branchName,
  buildPrompt,
  checkAll,
  checkLearnings,
  checkSchedules,
  evaluateSignal,
  globToRegExp,
  guardChanges,
  harnessCommand,
  HARNESSES,
  openPrsFor,
  parseFrontmatter,
  parseNumstat,
  plannedRequirements,
  pnpmScript,
  readHandoff,
  repoSlug,
  runTask,
  survivingMutants,
  taskFromBranch,
  tasksForCron,
  truncate,
  untranslatedStrings,
  validateTask,
  workflowCrons,
} from './agents.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');
const POLICY = JSON.parse(readFileSync(join(ROOT, '.agents/policy.json'), 'utf8'));

const EDIT = `---
name: spec-gap
summary: Turn one planned requirement into a test.
trigger: schedule
schedule: '17 5 * * 1'   # Mondays
signal: planned-requirements
mode: edit
deliverable: pr
scope: [docs/specs/, crates/]
gates: [pnpm test, cargo fmt --all -- --check]
max_changed_lines: 50
---

Pick one requirement.
`;
const task = (text = EDIT, file = '.agents/tasks/spec-gap.md') => ({
  file,
  ...parseFrontmatter(text),
});
const edited = (replace) =>
  task(Object.entries(replace).reduce((t, [from, to]) => t.replace(from, to), EDIT));
const ctx = {
  exists: () => true,
  skills: new Set(['ios-production']),
  scripts: new Set(['test', 'metrics']),
};
const REVIEW = task(
  `---
name: code-review
summary: Review the diff.
trigger: pull_request
signal: pr-diff
mode: read-only
deliverable: report
gates: []
---

Review it.
`,
  '.agents/tasks/code-review.md'
);

describe('task files (REQ-AGT-001)', () => {
  it('parses the frontmatter subset: quotes, numbers, lists, comments', () => {
    const { data, body } = task();
    assert.equal(data.schedule, '17 5 * * 1');
    assert.equal(data.max_changed_lines, 50);
    assert.deepEqual(data.scope, ['docs/specs/', 'crates/']);
    assert.deepEqual(data.gates, ['pnpm test', 'cargo fmt --all -- --check']);
    assert.equal(body, 'Pick one requirement.');
    assert.deepEqual(parseFrontmatter("---\nallow: ['a, b', c]\nx: []\n---\n").data, {
      allow: ['a, b', 'c'],
      x: [],
    });
  });

  it('reads lists wrapped over several lines, and block lists', () => {
    const wrapped =
      "---\nallow:\n  [a, b]\ngates:\n  [\n    pnpm test, # unit\n    cargo fmt --all -- --check,\n  ]\nscope:\n  - docs/\n  - 'crates/'\nname: x\n---\n";
    assert.deepEqual(parseFrontmatter(wrapped).data, {
      allow: ['a', 'b'],
      gates: ['pnpm test', 'cargo fmt --all -- --check'],
      scope: ['docs/', 'crates/'],
      name: 'x',
    });
    assert.deepEqual(parseFrontmatter('---\nsummary:\nname: x\n---\n').data, {
      summary: '',
      name: 'x',
    });
  });

  it('rejects a file without frontmatter or with a malformed line', () => {
    assert.throws(() => parseFrontmatter('# no frontmatter'), /must start with a --- block/);
    assert.throws(
      () => parseFrontmatter('---\nnot a pair\n---\n'),
      /line 2: expected "key: value"/
    );
    assert.throws(() => parseFrontmatter('---\nscope: [a, b\n---\n'), /unterminated list/);
  });

  it('accepts a valid edit task and a valid read-only task', () => {
    assert.deepEqual(validateTask(task(), ctx), []);
    assert.deepEqual(validateTask(REVIEW, ctx), []);
  });

  it('every task in the repo is valid, matches the workflow, and the learnings parse', () => {
    const { tasks, errors } = checkAll(ROOT);
    assert.deepEqual(errors, []);
    assert.ok(tasks.length >= 5, 'the template ships its starter tasks');
  });

  const cases = [
    [{ 'name: spec-gap\n': '' }, /missing "name"/],
    [{ 'mode: edit': 'mode: yolo' }, /"mode: yolo" must be one of edit, read-only/],
    [{ 'trigger: schedule': 'trigger: hourly' }, /"trigger: hourly" must be one of/],
    [{ 'name: spec-gap': 'name: other' }, /must match the file name/],
    [{ 'name: spec-gap': 'name: Spec_Gap' }, /kebab-case/],
    [{ 'max_changed_lines: 50': 'owner: me' }, /unknown field "owner"/],
    [{ 'max_changed_lines: 50': 'max_changed_lines: lots' }, /positive whole number/],
    [{ "schedule: '17 5 * * 1'": "schedule: 'mondays'" }, /five-field cron/],
    [{ 'trigger: schedule': 'trigger: manual' }, /only applies to "trigger: schedule"/],
    [{ 'scope: [docs/specs/, crates/]': 'scope: docs/' }, /"scope" must be a \[list\]/],
    [{ 'scope: [docs/specs/, crates/]\n': '' }, /an edit task needs a "scope"/],
    [{ 'deliverable: pr': 'deliverable: report' }, /delivers a pull request/],
    [{ 'gates: [pnpm test, cargo fmt --all -- --check]': 'gates: []' }, /at least one gate/],
    [{ 'signal: planned-requirements': 'signal: vibes' }, /"signal: vibes" is not a built-in/],
    [
      { 'pnpm test,': 'pnpm run lint,' },
      /runs pnpm script "lint", which package.json does not define/,
    ],
    [{ 'signal: planned-requirements': 'signal: pnpm bench --quick' }, /pnpm script "bench"/],
    [
      { 'max_changed_lines: 50': 'skills: [web-wizardry]' },
      /skill "web-wizardry" is not in .agents\/skills/,
    ],
    [{ 'Pick one requirement.': '' }, /the body is empty/],
  ];
  for (const [replace, error] of cases)
    it(`rejects ${error}`, () =>
      assert.match(validateTask(edited(replace), ctx).join('\n'), error));

  it('rejects a scope path that does not exist', () => {
    const errors = validateTask(task(), { ...ctx, exists: (path) => path !== 'crates/' });
    assert.deepEqual(errors, ['.agents/tasks/spec-gap.md: scope path "crates/" does not exist']);
  });

  it('a read-only task has no scope and cannot open a pull request', () => {
    const bad = task(
      REVIEW.file &&
        readFileSync(join(ROOT, '.agents/tasks/code-review.md'), 'utf8').replace(
          'deliverable: report',
          'deliverable: pr\nscope: [docs/]'
        ),
      '.agents/tasks/code-review.md'
    );
    const errors = validateTask(bad, ctx).join('\n');
    assert.match(errors, /drop "scope" and "allow"/);
    assert.match(errors, /cannot open a pull request/);
  });

  it('reports a parse error as a task error instead of crashing', () => {
    assert.deepEqual(validateTask({ file: 'x.md', parseError: 'no frontmatter' }, ctx), [
      'x.md: no frontmatter',
    ]);
  });

  it('knows pnpm commands from pnpm scripts', () => {
    assert.equal(pnpmScript('pnpm test'), 'test');
    assert.equal(pnpmScript('pnpm run spec:check'), 'spec:check');
    assert.equal(pnpmScript('pnpm audit --audit-level high'), null);
    assert.equal(pnpmScript('pnpm --filter web lint'), null);
    assert.equal(pnpmScript('cargo test'), null);
  });
});

describe('schedules (REQ-AGT-002)', () => {
  const yaml = 'on:\n  schedule:\n    - cron: \'17 5 * * 1\'\n    - cron: "0 0 * * *"\n';

  it('reads every cron from the workflow', () => {
    assert.deepEqual(workflowCrons(yaml), ['17 5 * * 1', '0 0 * * *']);
  });

  it('flags a task cron missing from the workflow and a workflow cron no task owns', () => {
    assert.deepEqual(checkSchedules([task()], ['17 5 * * 1']), []);
    assert.deepEqual(checkSchedules([task()], workflowCrons(yaml)), [
      ".github/workflows/agents.yml: cron '0 0 * * *' belongs to no task",
    ]);
    assert.deepEqual(checkSchedules([task()], []), [
      ".agents/tasks/spec-gap.md: cron '17 5 * * 1' is not in .github/workflows/agents.yml",
    ]);
  });

  it('maps a fired cron to its tasks only', () => {
    assert.deepEqual(tasksForCron([task(), REVIEW], '17 5 * * 1'), ['spec-gap']);
    assert.deepEqual(tasksForCron([task(), REVIEW], '1 1 * * *'), []);
  });
});

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

describe('prompt (REQ-AGT-004)', () => {
  const signal = { status: 1, evidence: 'REQ-X-2 [planned] Next' };

  it('states mode, scope, protected paths, budget, gates, evidence, hand-off and the repo rules', () => {
    const prompt = buildPrompt({
      task: edited({
        'max_changed_lines: 50':
          "max_changed_lines: 50\nallow: ['**/generated/']\nskills: [ios-production]",
      }),
      policy: POLICY,
      rules: '# Rules\nBe exact.',
      signal,
    });
    for (const expected of [
      '# Agent task: spec-gap',
      '**Mode: edit.** Change only paths under: `docs/specs/`, `crates/`.',
      'Never change: `AGENTS.md`',
      'except `**/generated/`',
      'At most 50 changed lines',
      'gates run after you',
      '`pnpm test`, `cargo fmt --all -- --check`',
      '`.agents/skills/ios-production/SKILL.md`',
      '## Evidence: `planned-requirements` exited 1',
      'REQ-X-2 [planned] Next',
      '`.agents/out/spec-gap/result.md`',
      'NO-CHANGE',
      'Doing nothing is a correct',
      'Never weaken, skip or delete a test',
      '# Rules\nBe exact.',
    ])
      assert.ok(prompt.includes(expected), `prompt is missing: ${expected}`);
  });

  it('a read-only prompt forbids changes and asks for the report itself', () => {
    const prompt = buildPrompt({ task: REVIEW, policy: POLICY, rules: '', signal });
    assert.match(prompt, /\*\*Mode: read-only\.\*\* Do not create, change or delete any file/);
    assert.match(prompt, /Reply with the report/);
    assert.doesNotMatch(prompt, /result\.md/);
  });

  it('is the same text whichever harness runs it', () => {
    const io = fakeIo();
    const prompts = HARNESSES.filter((h) => h !== 'jules' && h !== 'custom').map((harness) => {
      runTask(task(), { ...OPTS, harness, dryRun: true }, io);
      return io.files['.agents/out/spec-gap/prompt.md'];
    });
    assert.equal(new Set(prompts).size, 1);
  });
});

describe('harness adapters (REQ-AGT-005)', () => {
  const base = { promptFile: '.agents/out/t/prompt.md', repo: 'o/r', custom: 'my-agent --stdin' };

  it('read-only tasks use each harness’s own read-only setting', () => {
    assert.deepEqual(harnessCommand('claude', { ...base, readOnly: true }).args, [
      '-p',
      '--disallowedTools',
      'Edit',
      'Write',
      'NotebookEdit',
      'Bash',
    ]);
    assert.deepEqual(harnessCommand('codex', { ...base, readOnly: true }).args, [
      'exec',
      '--sandbox',
      'read-only',
      '-',
    ]);
    assert.ok(
      harnessCommand('gemini', { ...base, readOnly: true })
        .args.join(' ')
        .includes('--approval-mode plan')
    );
    assert.ok(
      harnessCommand('pi', { ...base, readOnly: true })
        .args.join(' ')
        .includes('--tools read')
    );
  });

  it('edit tasks may edit and build, but never get git write access', () => {
    const claude = harnessCommand('claude', { ...base, readOnly: false });
    assert.ok(claude.args.includes('acceptEdits'));
    assert.ok(claude.args.includes('Bash(pnpm:*)'));
    assert.ok(!claude.args.some((arg) => /git (commit|push)/.test(arg)));
    assert.deepEqual(harnessCommand('codex', { ...base, readOnly: false }).args, [
      'exec',
      '--sandbox',
      'workspace-write',
      '-',
    ]);
    assert.ok(harnessCommand('gemini', { ...base, readOnly: false }).args.includes('auto_edit'));
  });

  it('passes the prompt the way each harness reads it, plus extra arguments', () => {
    assert.equal(harnessCommand('claude', base).stdin, true);
    const pi = harnessCommand('pi', { ...base, extraArgs: ['--model', 'x'] });
    assert.equal(pi.stdin, false);
    assert.ok(pi.args.includes('@.agents/out/t/prompt.md'));
    assert.ok(pi.args.includes('--model'));
    assert.deepEqual(harnessCommand('custom', base), {
      command: 'sh',
      args: ['-c', 'my-agent --stdin'],
      stdin: true,
    });
    assert.deepEqual(harnessCommand('jules', base), {
      command: 'jules',
      args: ['remote', 'new', '--repo', 'o/r'],
      stdin: true,
      async: true,
    });
  });

  it('fails clearly on a missing setting or an unknown harness', () => {
    assert.throws(() => harnessCommand('jules', { ...base, repo: null }), /AGENT_REPO/);
    assert.throws(
      () => harnessCommand('custom', { ...base, custom: undefined }),
      /AGENT_CMD is not set/
    );
    assert.throws(() => harnessCommand('copilot', base), /unknown harness "copilot"/);
  });

  it('reads the GitHub repository from an origin URL', () => {
    assert.equal(repoSlug('git@github.com:bishalg/create-TRAN.git'), 'bishalg/create-TRAN');
    assert.equal(repoSlug('https://github.com/bishalg/create-TRAN\n'), 'bishalg/create-TRAN');
    assert.equal(repoSlug('https://gitlab.com/x/y.git'), null);
  });
});

describe('guard (REQ-AGT-007)', () => {
  it('matches prefixes, any-depth names and single-segment stars', () => {
    assert.ok(globToRegExp('docs/specs/').test('docs/specs/015-agents.md'));
    assert.ok(!globToRegExp('docs/specs/').test('docs/specs.md'));
    assert.ok(globToRegExp('**/package.json').test('package.json'));
    assert.ok(globToRegExp('**/package.json').test('apps/web/package.json'));
    assert.ok(globToRegExp('**/generated/').test('packages/core-ts/src/generated/rules.ts'));
    assert.ok(globToRegExp('**/*.gradle.kts').test('apps/android/app/build.gradle.kts'));
    assert.ok(!globToRegExp('Cargo.lock').test('crates/Cargo.lock'));
  });

  it('passes a change inside scope and budget', () => {
    assert.deepEqual(
      guardChanges([{ path: 'crates/rust-core/src/lib.rs', lines: 20 }], task(), POLICY),
      []
    );
  });

  it('fails a file outside scope, a protected file, and a change over budget', () => {
    const errors = guardChanges(
      [
        { path: 'apps/web/src/main.tsx', lines: 10 },
        { path: 'crates/rust-core/Cargo.toml', lines: 2 },
        { path: 'docs/specs/001-eligibility-rules.md', lines: 40 },
      ],
      task(),
      POLICY
    );
    assert.deepEqual(errors, [
      "apps/web/src/main.tsx: outside the task's scope (docs/specs/, crates/)",
      'crates/rust-core/Cargo.toml: protected by .agents/policy.json',
      '52 changed lines, over the budget of 50',
    ]);
  });

  it('a task may allow a protected path; it can never allow its own rules', () => {
    const allowing = edited({ 'max_changed_lines: 50': "allow: ['**/Cargo.toml']" });
    assert.deepEqual(
      guardChanges([{ path: 'crates/rust-core/Cargo.toml', lines: 2 }], allowing, POLICY),
      []
    );
    assert.ok(POLICY.protected.includes('.agents/'), 'task files and the policy are protected');
    assert.ok(POLICY.protected.includes('.github/'), 'workflows are protected');
  });

  it('a read-only task may change nothing', () => {
    assert.deepEqual(guardChanges([], REVIEW, POLICY), []);
    assert.deepEqual(guardChanges([{ path: 'a.ts', lines: 1 }], REVIEW, POLICY), [
      'a read-only task changed files: a.ts',
    ]);
  });

  it('counts changed lines from numstat, a binary file as one', () => {
    assert.deepEqual(parseNumstat('3\t1\ta.ts\n-\t-\tlogo.png\n0\t0\tempty.txt\n'), [
      { path: 'a.ts', lines: 4 },
      { path: 'logo.png', lines: 1 },
      { path: 'empty.txt', lines: 1 },
    ]);
  });
});

describe('branches and open pull requests (REQ-AGT-008)', () => {
  const names = ['spec-gap', 'spec-gap-native', 'code-review'];

  it('names a branch after the task and the time, and reads the task back', () => {
    const branch = branchName('spec-gap', 'agent/', new Date('2026-10-21T05:17:42Z'));
    assert.equal(branch, 'agent/spec-gap-20261021-051742');
    assert.equal(taskFromBranch(branch, 'agent/', names), 'spec-gap');
    assert.equal(
      taskFromBranch('agent/spec-gap-native-20261021-0517', 'agent/', names),
      'spec-gap-native'
    );
    assert.equal(taskFromBranch('feat/spec-gap', 'agent/', names), null);
    assert.equal(taskFromBranch('agent/unknown-1', 'agent/', names), null);
  });

  it('finds only the open pull requests of this task', () => {
    const prs = [
      { headRefName: 'agent/spec-gap-20261014-0517', url: 'u1' },
      { headRefName: 'agent/spec-gap-native-20261014-0517', url: 'u2' },
      { headRefName: 'feat/x', url: 'u3' },
    ];
    assert.deepEqual(
      openPrsFor('spec-gap', 'agent/', prs, names).map((p) => p.url),
      ['u1']
    );
  });

  it('skips a task that already has an open pull request', () => {
    const io = fakeIo({
      openPrs: [{ headRefName: 'agent/spec-gap-20261014-0517', url: 'https://x/pr/9' }],
    });
    const result = runTask(task(), { ...OPTS, publish: true }, io);
    assert.equal(result.outcome, 'skipped');
    assert.match(result.message, /pr\/9/);
    assert.equal(io.calls.harness, 0);
  });

  it('continues, with a note, when open pull requests cannot be listed', () => {
    const io = fakeIo({
      openPrs: null,
      handoff: 'feat: x\n\nWhat',
      changes: [{ path: 'crates/a.rs', lines: 3 }],
    });
    assert.equal(runTask(task(), { ...OPTS, publish: true }, io).outcome, 'published');
    assert.match(io.logs.join('\n'), /could not list open pull requests/);
  });
});

/** Records every side effect; each behaviour is set per test through `over`. */
function fakeIo(over = {}) {
  const state = {
    clean: true,
    signal: { status: 1, output: 'REQ-X-2 [planned] Next' },
    openPrs: [],
    harness: { status: 0, output: 'done' },
    handoff: null,
    changes: [],
    gate: () => ({ status: 0, output: 'ok' }),
    statusBefore: '',
    statusAfter: '',
    ...over,
  };
  let harnessRan = false;
  const io = {
    files: { 'AGENTS.md': '# Rules' },
    logs: [],
    calls: {
      harness: 0,
      gates: [],
      commit: null,
      publish: null,
      comment: null,
      branch: [],
      discarded: null,
      restored: 0,
    },
    isClean: () => state.clean,
    status: () => (harnessRan ? state.statusAfter : state.statusBefore),
    runSignal: () => state.signal,
    openPrs: () => state.openPrs,
    readFile: (path) => (path.endsWith('result.md') ? state.handoff : (io.files[path] ?? null)),
    writeFile: (path, text) => {
      io.files[path] = text;
    },
    removeFile: (path) => delete io.files[path],
    startBranch: (branch) => {
      io.calls.branch.push(branch);
      return branch;
    },
    restoreBranch: () => io.calls.restored++,
    discardBranch: (branch) => (io.calls.discarded = branch),
    runHarness: (command, prompt) => {
      io.calls.harness++;
      io.calls.command = command;
      io.calls.prompt = prompt;
      harnessRan = true;
      return state.harness;
    },
    changes: () => state.changes,
    runGate: (command) => {
      io.calls.gates.push(command);
      return state.gate(command);
    },
    commit: (message) => (io.calls.commit = message),
    publish: (pr) => {
      io.calls.publish = pr;
      return 'https://github.com/o/r/pull/12';
    },
    comment: (number, body) => (io.calls.comment = { number, body }),
    log: (message) => io.logs.push(message),
  };
  return io;
}
const OPTS = {
  harness: 'claude',
  policy: POLICY,
  now: new Date('2026-10-21T05:17:00Z'),
  taskNames: ['spec-gap', 'code-review'],
  harnessOptions: {},
};

describe('run: signal first (REQ-AGT-003)', () => {
  it('no signal: the harness never starts and nothing is written', () => {
    const io = fakeIo({ signal: { status: 0, output: 'no [planned] requirements' } });
    const result = runTask(task(), OPTS, io);
    assert.equal(result.outcome, 'no-signal');
    assert.equal(io.calls.harness, 0);
    assert.deepEqual(io.calls.branch, []);
  });

  it('a signal that cannot run fails the run without starting the harness', () => {
    const io = fakeIo({ signal: { status: 127, output: 'sh: pnpm: command not found' } });
    const result = runTask(task(), OPTS, io);
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /could not run \(exit 127\); the agent was not started/);
    assert.equal(io.calls.harness, 0);
  });

  it('a dry run writes the prompt with the evidence and starts nothing', () => {
    const io = fakeIo({ clean: false });
    const result = runTask(task(), { ...OPTS, dryRun: true }, io);
    assert.equal(result.outcome, 'dry-run');
    assert.match(io.files['.agents/out/spec-gap/prompt.md'], /REQ-X-2 \[planned\] Next/);
    assert.equal(io.calls.harness, 0);
  });
});

describe('run: the runner verifies, not the agent (REQ-AGT-006)', () => {
  const good = {
    handoff: 'test(core): cover REQ-X-2\n\n**What** a test',
    changes: [{ path: 'crates/a.rs', lines: 12 }],
  };

  it('refuses an edit task on a dirty working tree', () => {
    const io = fakeIo({ clean: false });
    assert.match(runTask(task(), OPTS, io).message, /uncommitted changes/);
    assert.equal(io.calls.harness, 0);
  });

  it('runs on a fresh agent branch, then guard and gates, then commits and returns to the original branch', () => {
    const io = fakeIo(good);
    const result = runTask(task(), OPTS, io);
    assert.equal(result.outcome, 'committed');
    assert.deepEqual(io.calls.branch, ['agent/spec-gap-20261021-051700']);
    assert.deepEqual(io.calls.gates, ['pnpm test', 'cargo fmt --all -- --check']);
    assert.match(
      io.calls.commit,
      /^test\(core\): cover REQ-X-2\n\n\*\*What\*\* a test\n\nAgent-Task: spec-gap\nAgent-Harness: claude$/
    );
    assert.equal(io.calls.restored, 1);
    assert.equal(io.calls.publish, null);
  });

  it('with --publish opens a draft pull request whose body says what the runner verified', () => {
    const io = fakeIo(good);
    const result = runTask(task(), { ...OPTS, publish: true }, io);
    assert.equal(result.outcome, 'published');
    assert.equal(io.calls.publish.title, 'test(core): cover REQ-X-2');
    for (const expected of [
      '**What** a test',
      '`planned-requirements` exited 1',
      '✅ `pnpm test`',
      'Verified by the runner, not the agent',
      'never merge themselves',
    ])
      assert.ok(io.calls.publish.body.includes(expected), expected);
  });

  it('a failing gate keeps nothing: no commit, no pull request, the failure reported', () => {
    const io = fakeIo({
      ...good,
      gate: (command) =>
        command === 'pnpm test' ? { status: 1, output: '1 failed' } : { status: 0, output: '' },
    });
    const result = runTask(task(), { ...OPTS, publish: true }, io);
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /gate failed: pnpm test\n1 failed/);
    assert.equal(io.calls.commit, null);
    assert.equal(io.calls.publish, null);
    assert.match(io.files['.agents/out/spec-gap/verification.md'], /pnpm test/);
  });

  it('a guard failure skips the gates and keeps nothing', () => {
    const io = fakeIo({ ...good, changes: [{ path: '.github/workflows/ci.yml', lines: 1 }] });
    const result = runTask(task(), OPTS, io);
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /\.github\/workflows\/ci\.yml: outside the task's scope/);
    assert.match(result.message, /protected by \.agents\/policy\.json/);
    assert.deepEqual(io.calls.gates, []);
    assert.equal(io.calls.commit, null);
  });

  it('NO-CHANGE with no changes is a clean outcome; the branch is discarded', () => {
    const io = fakeIo({
      handoff:
        'NO-CHANGE: every planned requirement needs a design decision\n\nREQ-X-2 needs an ADR.',
    });
    const result = runTask(task(), OPTS, io);
    assert.equal(result.outcome, 'no-change');
    assert.match(result.message, /needs a design decision/);
    assert.equal(result.detail, 'REQ-X-2 needs an ADR.');
    assert.equal(io.calls.discarded, 'agent/spec-gap-20261021-051700');
  });

  it('an agent that changed nothing and wrote nothing is also no change', () => {
    assert.equal(runTask(task(), OPTS, fakeIo()).message, 'spec-gap: the agent changed nothing');
  });

  it('NO-CHANGE with changes, or changes without a hand-off, are failures left for a person', () => {
    const lying = runTask(task(), OPTS, fakeIo({ ...good, handoff: 'NO-CHANGE: nothing needed' }));
    assert.match(lying.message, /wrote NO-CHANGE but changed 1 file/);
    const silent = runTask(task(), OPTS, fakeIo({ ...good, handoff: null }));
    assert.match(silent.message, /wrote no hand-off/);
  });

  it('a harness failure or timeout is reported with its log', () => {
    const io = fakeIo({ harness: { status: null, output: 'partial' } });
    const result = runTask(task(), OPTS, io);
    assert.match(
      result.message,
      /claude exited with a timeout; see \.agents\/out\/spec-gap\/harness\.log/
    );
    assert.equal(io.files['.agents/out/spec-gap/harness.log'], 'partial');
    assert.match(
      runTask(task(), OPTS, fakeIo({ harness: { status: 2 } })).message,
      /exited with 2/
    );
  });

  it('a stale hand-off from an earlier run is removed before the harness starts', () => {
    const io = fakeIo();
    io.files['.agents/out/spec-gap/result.md'] = 'old';
    runTask(task(), OPTS, io);
    assert.equal(io.files['.agents/out/spec-gap/result.md'], undefined);
  });

  it('Jules runs elsewhere: dispatched, no branch, no local verification', () => {
    const io = fakeIo({ harness: { status: 0, output: 'session 123' } });
    const result = runTask(
      task(),
      { ...OPTS, harness: 'jules', harnessOptions: { repo: 'o/r' } },
      io
    );
    assert.equal(result.outcome, 'dispatched');
    assert.match(result.message, /session 123/);
    assert.deepEqual(io.calls.branch, []);
    assert.deepEqual(io.calls.gates, []);
  });
});

describe('run: read-only tasks (REQ-AGT-005)', () => {
  const diff = {
    signal: { status: 1, output: 'diff --git a/x b/x' },
    harness: { status: 0, output: 'Looks good\n' },
  };

  it('a read-only task may run on a dirty tree and writes its report', () => {
    const io = fakeIo({ ...diff, clean: false });
    const result = runTask(REVIEW, OPTS, io);
    assert.equal(result.outcome, 'reported');
    assert.equal(io.files['.agents/out/code-review/report.md'], 'Looks good');
    assert.deepEqual(io.calls.branch, []);
    assert.deepEqual(io.calls.command.args.slice(0, 2), ['-p', '--disallowedTools']);
  });

  it('posts the report on the pull request with --publish --pr', () => {
    const io = fakeIo(diff);
    const result = runTask(REVIEW, { ...OPTS, publish: true, pr: '42' }, io);
    assert.equal(result.outcome, 'published');
    assert.equal(io.calls.comment.number, '42');
    assert.match(
      io.calls.comment.body,
      /^Looks good\n\n---\n_Agent task `code-review` via claude; read-only/
    );
  });

  it('fails when the working tree changed anyway', () => {
    const io = fakeIo({ ...diff, statusAfter: ' M apps/web/src/main.tsx\n' });
    const result = runTask(REVIEW, { ...OPTS, publish: true, pr: '42' }, io);
    assert.match(result.message, /read-only task changed the working tree/);
    assert.equal(io.calls.comment, null);
  });
});

describe('hand-off', () => {
  it('reads a title and body, or a NO-CHANGE reason, or nothing', () => {
    assert.deepEqual(readHandoff('# `feat: x`\n\nbody\n'), { title: 'feat: x', body: 'body' });
    assert.deepEqual(readHandoff('NO-CHANGE: not needed'), {
      noChange: true,
      reason: 'not needed',
      body: '',
    });
    assert.deepEqual(readHandoff('  \n'), { missing: true });
    assert.deepEqual(readHandoff(null), { missing: true });
  });
});

describe('learnings (REQ-AGT-009)', () => {
  it('accepts dated entries with a learning and an action', () => {
    const md =
      '# Learnings\n\nIntro.\n\n## 2026-10-20 - Dates follow the locale\n\n**Learning:** x\n**Action:** y\n';
    assert.deepEqual(checkLearnings(md), { entries: 1, errors: [] });
  });

  it('rejects an undated heading and a missing learning or action', () => {
    const md =
      '## Dates follow the locale\n\n**Learning:** x\n\n## 2026-13-45 - Bad date\n\n**Action:** y\n';
    assert.deepEqual(checkLearnings(md).errors, [
      'docs/LEARNINGS.md: "## Dates follow the locale" must read "## YYYY-MM-DD - Title"',
      'docs/LEARNINGS.md: "## Dates follow the locale" needs a "**Action:** …" line',
      'docs/LEARNINGS.md: "## 2026-13-45 - Bad date" must read "## YYYY-MM-DD - Title"',
      'docs/LEARNINGS.md: "## 2026-13-45 - Bad date" needs a "**Learning:** …" line',
    ]);
  });
});
