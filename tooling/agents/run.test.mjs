// Verifies: REQ-AGT-003, REQ-AGT-005, REQ-AGT-006
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readHandoff, runTask } from './agents.mjs';
import { task, REVIEW, fakeIo, OPTS } from './test-helpers.mjs';

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
