// Verifies: REQ-AGT-003, REQ-AGT-005, REQ-AGT-006, REQ-ISS-009, REQ-ISS-010
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readHandoff, runTask } from './agents.mjs';
import { liveIo } from './run.mjs';
import { task, REVIEW, ISSUE, fakeIo, fakeIssueHandoff, OPTS, ROOT } from './test-helpers.mjs';

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

describe('run: issue options (REQ-ISS-009, REQ-ISS-010)', () => {
  const ISSUE_OPTS = { ...OPTS, taskNames: ['issue', 'issue-gate', 'spec-gap'] };
  const handoff = 'feat(core): look up the country\n\n**What** A lookup.\n\n**Risk** Low.';

  it('a code change without a test is not kept (REQ-ISS-010)', () => {
    const io = fakeIo({ handoff, changes: [{ path: 'crates/rust-core/src/phone.rs', lines: 9 }] });
    const result = runTask(ISSUE, { ...ISSUE_OPTS, requireTests: true }, io);
    assert.equal(result.outcome, 'failed');
    assert.match(
      result.message,
      /code change without a test change: crates\/rust-core\/src\/phone\.rs/
    );
    assert.deepEqual(io.calls.gates, []);
    assert.equal(io.calls.commit, null);
    assert.match(io.files['.agents/out/issue/verification.md'], /issues\.requireTests/);

    const tested = fakeIo({
      handoff,
      changes: [
        { path: 'crates/rust-core/src/phone.rs', lines: 9 },
        { path: 'crates/rust-core/tests/phone.rs', lines: 9 },
      ],
    });
    assert.equal(
      runTask(ISSUE, { ...ISSUE_OPTS, requireTests: true }, tested).outcome,
      'committed'
    );
    // Off by default: scheduled tasks keep today's rules.
    const io2 = fakeIo({ handoff, changes: [{ path: 'crates/rust-core/src/phone.rs', lines: 9 }] });
    assert.equal(runTask(ISSUE, ISSUE_OPTS, io2).outcome, 'committed');
  });

  it('one branch, one pull request per issue (REQ-ISS-009)', () => {
    const branch = 'agent/issue-12-add-country-lookup';
    const io = fakeIo({
      handoff: fakeIssueHandoff(),
      changes: [{ path: 'docs/LEARNINGS.md', lines: 6 }],
      openPrs: [{ headRefName: 'agent/issue-13-other', url: 'https://github.com/o/r/pull/7' }],
    });
    io.files['.github/pull_request_template.md'] = readFileSync(
      join(ROOT, '.github/pull_request_template.md'),
      'utf8'
    );
    const opts = {
      ...ISSUE_OPTS,
      publish: true,
      branch,
      prMatch: 'agent/issue-12-',
      closes: 12,
      extraEvidence: '## Approved plan\n\nthe plan',
    };
    const result = runTask(ISSUE, opts, io);
    assert.equal(result.outcome, 'published', result.message);
    assert.deepEqual(io.calls.branch, [branch]);
    assert.equal(io.calls.publish.branch, branch);
    const body = io.calls.publish.body;
    assert.equal(body.split('\n')[0], 'Closes #12');
    assert.match(body, /^## What\n\nOne entry in `docs\/LEARNINGS\.md`/m);
    assert.match(body, /^## Verification\n\nNone by the fake/m);
    assert.match(body, /\*\*Harness:\*\* claude/);
    assert.match(body, /Verified by the runner, not the agent/);
    assert.ok(io.calls.prompt.trimEnd().endsWith('## Approved plan\n\nthe plan'));

    // A pull request for this issue blocks a second run; one for another issue does not.
    const blocked = fakeIo({
      openPrs: [{ headRefName: 'agent/issue-12-old', url: 'https://github.com/o/r/pull/8' }],
    });
    const skipped = runTask(ISSUE, opts, blocked);
    assert.equal(skipped.outcome, 'skipped');
    assert.match(skipped.message, /pull\/8/);
    assert.equal(blocked.calls.harness, 0);
    // Without prMatch the dedupe stays per task, as scheduled tasks need (REQ-AGT-008).
    const perTask = fakeIo({
      openPrs: [{ headRefName: 'agent/issue-13-other', url: 'https://github.com/o/r/pull/7' }],
    });
    assert.equal(runTask(ISSUE, { ...ISSUE_OPTS, publish: true }, perTask).outcome, 'skipped');
  });

  it('publish updates the open pull request of the branch instead of opening another', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-publish-'));
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    git('init', '-q', '--bare', 'remote.git');
    git('init', '-q', '-b', 'dev', 'work');
    const work = join(dir, 'work');
    const inWork = (...args) => {
      const r = spawnSync('git', args, { cwd: work, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    };
    inWork('config', 'user.name', 'Test');
    inWork('config', 'user.email', 'test@example.com');
    inWork('remote', 'add', 'origin', join(dir, 'remote.git'));
    writeFileSync(join(work, 'a.txt'), 'a\n');
    inWork('add', '-A');
    inWork('commit', '-q', '-m', 'init');
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push([command, ...args].join(' '));
      if (args[1] === 'list')
        return { status: 0, stdout: '[{"number":8,"url":"https://github.com/o/r/pull/8"}]' };
      return { status: 0, stdout: options.input ? 'ok' : '' };
    };
    const io = liveIo(work, { spawn });
    io.startBranch('agent/issue-12-x');
    writeFileSync(join(work, 'b.txt'), 'b\n');
    io.commit('docs: b');
    const url = io.publish({ branch: 'agent/issue-12-x', title: 'docs: b', body: 'Closes #12' });
    assert.equal(url, 'https://github.com/o/r/pull/8');
    assert.deepEqual(calls, [
      'gh pr list --head agent/issue-12-x --state open --json number,url --limit 1',
      'gh pr edit 8 --title docs: b --body-file -',
    ]);
    assert.match(git('--git-dir', 'remote.git', 'branch'), /agent\/issue-12-x/);

    // No open pull request for the branch: create one, as before.
    calls.length = 0;
    const create = (command, args) => {
      calls.push(args[1]);
      return { status: 0, stdout: args[1] === 'list' ? '[]' : 'https://github.com/o/r/pull/9\n' };
    };
    const fresh = liveIo(work, { spawn: create });
    fresh.startBranch('agent/issue-12-y');
    writeFileSync(join(work, 'c.txt'), 'c\n');
    fresh.commit('docs: c');
    assert.equal(
      fresh.publish({ branch: 'agent/issue-12-y', title: 't', body: 'b' }),
      'https://github.com/o/r/pull/9'
    );
    assert.deepEqual(calls, ['list', 'create']);
  });
});
