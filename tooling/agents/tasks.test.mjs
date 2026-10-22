// Verifies: REQ-AGT-001, REQ-AGT-002, REQ-AGT-009, REQ-AGT-010
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  checkAll,
  checkLearnings,
  checkSchedules,
  chooseHarness,
  HARNESSES,
  parseFrontmatter,
  pnpmScript,
  tasksForCron,
  validateTask,
  workflowCrons,
} from './agents.mjs';
import { ROOT, task, edited, ctx, REVIEW } from './test-helpers.mjs';

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

describe('default harness (REQ-AGT-010)', () => {
  it('takes --harness, then AGENT_HARNESS, then the policy, then claude', () => {
    const policy = { defaultHarness: 'codex' };
    assert.equal(chooseHarness('pi', { AGENT_HARNESS: 'gemini' }, policy), 'pi');
    assert.equal(chooseHarness(undefined, { AGENT_HARNESS: 'gemini' }, policy), 'gemini');
    assert.equal(chooseHarness(undefined, {}, policy), 'codex');
    assert.equal(chooseHarness(undefined, {}, {}), 'claude');
  });

  it('check rejects a policy that names an unknown harness', () => {
    assert.deepEqual(checkAll(ROOT, { defaultHarness: 'claude' }).errors, []);
    assert.deepEqual(checkAll(ROOT, { defaultHarness: 'copilot' }).errors, [
      `.agents/policy.json: defaultHarness "copilot" is not one of ${HARNESSES.join(', ')}`,
    ]);
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
