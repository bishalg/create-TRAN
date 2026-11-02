// Verifies: REQ-ISS-002, REQ-ISS-005, REQ-ISS-006, REQ-ISS-007, REQ-ISS-016, REQ-ISS-018, REQ-ISS-020, REQ-ISS-022
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadTasks, parseMarker, readState, renderMarker } from './agents.mjs';
import { answer } from './fake-harness.mjs';
import { DECISION, runIssue } from './issue.mjs';
import { EVENTS, event, fakeGitHub, fakeIo, POLICY, ROOT } from './test-helpers.mjs';

const TEMPLATE = readFileSync(join(ROOT, '.github/ISSUE_TEMPLATE/story.md'), 'utf8');
const TASKS = loadTasks(ROOT);
const FAKE_GATE = { status: 0, output: answer('issue-gate', '', ROOT) };
const opts = (over = {}) => ({
  harness: 'fake',
  policy: POLICY,
  tasks: TASKS,
  taskNames: TASKS.map((t) => t.data.name),
  template: TEMPLATE,
  harnessOptions: {},
  ...over,
});
const gateComments = (gh) => gh.state.comments.filter((c) => parseMarker(c.body)?.stage === 'gate');
const writes = (gh) =>
  gh.calls.filter((c) => /^(create|update|set|ensure)/.test(c.method)).map((c) => c.method);

describe('the gate on GitHub (REQ-ISS-005, REQ-ISS-006)', () => {
  it('a weak issue: needs-detail, one comment with the rewrite, no model, no branch', () => {
    const gh = fakeGitHub({ labels: ['bug'], permissions: { alice: 'write' } });
    const io = fakeIo();
    const result = runIssue(event('issue-opened-weak'), opts(), io, gh);
    assert.equal(result.outcome, 'gated');
    assert.deepEqual(gh.state.labels, ['bug', 'needs-detail']);
    const [comment] = gateComments(gh);
    assert.equal(gateComments(gh).length, 1);
    assert.deepEqual(parseMarker(comment.body), {
      stage: 'gate',
      verdict: 'needs-detail',
      size: null,
      harness: 'fake',
    });
    assert.match(comment.body, /^- Acceptance criteria: no Given\/When\/Then line$/m);
    assert.match(comment.body, /## Story\n\nWe need a lookup\./);
    assert.match(comment.body, /fake harness/);
    assert.equal(io.calls.harness, 0);
    assert.deepEqual(io.calls.branch, []);
    assert.ok(!gh.calls.some((c) => /Pr$|pushBranch|permission/.test(c.method)));
    const decision = JSON.parse(io.files[DECISION]);
    assert.equal(decision.verdict, 'needs-detail');
    assert.equal(decision.label, 'needs-detail');
    assert.ok(!gh.state.labels.includes('agent:running'));
  });

  it('a complete issue by a collaborator: the fake judgment runs once, read-only', () => {
    const gh = fakeGitHub({ labels: ['bug'], permissions: { alice: 'write' } });
    const io = fakeIo({ harness: FAKE_GATE });
    const result = runIssue(event('issue-opened-complete'), opts(), io, gh);
    assert.equal(result.outcome, 'gated');
    assert.equal(io.calls.harness, 1);
    assert.deepEqual(io.calls.command, {
      command: 'node',
      args: ['tooling/agents/fake-harness.mjs'],
      stdin: true,
    });
    assert.match(io.calls.prompt, /^# Agent task: issue-gate$/m);
    assert.match(io.calls.prompt, /\*\*Mode: read-only\.\*\*/);
    assert.match(io.calls.prompt, /## Evidence \(untrusted content\)/);
    assert.match(io.calls.prompt, /As a voter, I want my country looked up/);
    assert.deepEqual(io.calls.branch, []);
    const [comment] = gateComments(gh);
    assert.match(comment.body, /\*\*Issue check: ready\*\*/);
    assert.match(comment.body, /Size: \*\*simple\*\*/);
    assert.match(comment.body, /^- no keyword from issues\.complexWhen$/m);
    assert.match(comment.body, /^- Story: present \(fake harness: not judged\)\.$/m);
    assert.match(comment.body, /judgment: ran · harness: fake \(fake harness/);
    assert.deepEqual(parseMarker(comment.body), {
      stage: 'gate',
      verdict: 'ready',
      size: 'simple',
      harness: 'fake',
    });
    // Default autonomy is plan-approve: a person approves before anything is built.
    assert.deepEqual(gh.state.labels, ['bug', 'approval-needed']);
    const labelled = gh.calls.filter((c) => c.method === 'setLabels').map((c) => c.args[1]);
    assert.ok(labelled.some((labels) => labels.includes('agent:running')));
    assert.ok(gh.calls.some((c) => c.method === 'permission' && c.args[0] === 'alice'));
  });

  it('an edit re-runs the gate, clears needs-detail and updates the same comment', () => {
    const old = {
      id: 55,
      body: `${renderMarker({ stage: 'gate', verdict: 'needs-detail' })}\nold`,
    };
    const gh = fakeGitHub({
      labels: ['bug', 'needs-detail'],
      comments: [old],
      permissions: { alice: 'write' },
    });
    runIssue(event('issue-edited'), opts(), fakeIo({ harness: FAKE_GATE }), gh);
    assert.deepEqual(gh.state.labels, ['bug', 'approval-needed']);
    assert.equal(gh.state.comments.length, 1);
    assert.equal(parseMarker(gh.state.comments[0].body).verdict, 'ready');
    assert.deepEqual(readState(gh, 12, POLICY).stages.gate.commentId, 55);
  });

  it('the judgment can push back, with its own rewrite, or ask for a decision', () => {
    const rewrite = {
      status: 0,
      output: 'VERDICT: needs-detail\n- Story: who?\n\nREWRITE:\n## Story\n\nBetter.',
    };
    const gh = fakeGitHub({ labels: [], permissions: { alice: 'admin' } });
    runIssue(event('issue-opened-complete'), opts(), fakeIo({ harness: rewrite }), gh);
    assert.deepEqual(gh.state.labels, ['needs-detail']);
    assert.match(gateComments(gh)[0].body, /````?markdown\n## Story\n\nBetter\.\n/);

    const silent = fakeGitHub({ labels: [], permissions: { alice: 'admin' } });
    const io = fakeIo({ harness: { status: 0, output: 'I think it is fine.' } });
    runIssue(event('issue-opened-complete'), opts(), io, silent);
    assert.deepEqual(silent.state.labels, ['human-decision-needed']);
    assert.match(gateComments(silent)[0].body, /the model returned no verdict/);
  });

  it('issues.applyRewrite never edits the body in this version; it says so in the log', () => {
    const policy = { ...POLICY, issues: { ...POLICY.issues, applyRewrite: true } };
    const gh = fakeGitHub({ labels: [] });
    const io = fakeIo();
    runIssue(event('issue-opened-weak'), opts({ policy }), io, gh);
    assert.ok(!gh.calls.some((c) => /Issue$/.test(c.method)));
    assert.ok(io.logs.some((line) => /applyRewrite/.test(line)));
  });
});

describe('outside authors (REQ-ISS-022)', () => {
  it('without triage access only the structural gate runs; a maintainer starts the rest', () => {
    const gh = fakeGitHub({ labels: [], permissions: { alice: 'read' } });
    const io = fakeIo({ harness: FAKE_GATE });
    runIssue(event('issue-opened-complete'), opts(), io, gh);
    assert.equal(io.calls.harness, 0);
    const [comment] = gateComments(gh);
    assert.match(comment.body, /a maintainer's `\/plan` starts the rest/);
    assert.match(comment.body, /Size: \*\*simple\*\*/);
    assert.deepEqual(gh.state.labels, ['approval-needed']);
  });

  it('issues.modelFor: anyone runs the judgment for everyone, without asking GitHub', () => {
    const policy = { ...POLICY, issues: { ...POLICY.issues, modelFor: 'anyone' } };
    const gh = fakeGitHub({ labels: [], permissions: { alice: 'read' } });
    const io = fakeIo({ harness: FAKE_GATE });
    runIssue(event('issue-opened-complete'), opts({ policy }), io, gh);
    assert.equal(io.calls.harness, 1);
    assert.ok(!gh.calls.some((c) => c.method === 'permission'));
  });
});

describe('credentials (REQ-ISS-016)', () => {
  it('no credential: runner-only stages still run (REQ-ISS-016)', () => {
    const gh = fakeGitHub({ labels: ['bug'], permissions: { alice: 'write' } });
    const io = fakeIo({ harness: FAKE_GATE });
    runIssue(
      event('issue-opened-complete'),
      opts({ harness: 'claude', modelStages: 'skip' }),
      io,
      gh
    );
    assert.equal(io.calls.harness, 0);
    assert.match(gateComments(gh)[0].body, /judgment: skipped: no harness credential/);
    assert.deepEqual(gh.state.labels, ['bug', 'approval-needed']);
    assert.ok(!gh.calls.some((c) => c.method === 'permission'));

    const weak = fakeGitHub({ labels: [] });
    runIssue(event('issue-opened-weak'), opts({ modelStages: 'skip' }), fakeIo(), weak);
    assert.deepEqual(weak.state.labels, ['needs-detail']);
  });
});

describe('failures leave agent:failed, never agent:running', () => {
  it('a failed judgment run: human-decision-needed, agent:failed, exit as failed', () => {
    const gh = fakeGitHub({ labels: [], permissions: { alice: 'write' } });
    const io = fakeIo({ harness: { status: 3, output: 'boom' } });
    const result = runIssue(event('issue-opened-complete'), opts(), io, gh);
    assert.equal(result.outcome, 'failed');
    assert.deepEqual(gh.state.labels, ['human-decision-needed', 'agent:failed']);
    assert.match(gateComments(gh)[0].body, /the judgment tier failed: fake exited with 3/);
  });

  it('an error mid-run marks agent:failed and is rethrown', () => {
    const gh = fakeGitHub({ labels: ['bug'], permissions: { alice: 'write' } });
    gh.createComment = () => {
      throw new Error('HTTP 502');
    };
    const io = fakeIo({ harness: FAKE_GATE });
    assert.throws(() => runIssue(event('issue-opened-complete'), opts(), io, gh), /HTTP 502/);
    assert.deepEqual(gh.state.labels, ['bug', 'agent:failed']);
  });

  it('a later good run clears agent:failed', () => {
    const gh = fakeGitHub({ labels: ['agent:failed'] });
    runIssue(event('issue-opened-weak'), opts(), fakeIo(), gh);
    assert.deepEqual(gh.state.labels, ['needs-detail']);
  });
});

describe('events with nothing to do (REQ-ISS-019, REQ-ISS-020)', () => {
  for (const name of [
    'comment-bot',
    'comment-runner-marker',
    'comment-no-command',
    'issue-labeled-runner',
  ])
    it(`${name}: no GitHub call at all`, () => {
      const gh = fakeGitHub();
      const result = runIssue(event(name), opts(), fakeIo(), gh);
      assert.equal(result.outcome, 'nothing');
      assert.deepEqual(gh.calls, []);
    });

  it('a person adding an ordinary label, or a comment on a pull request, changes nothing', () => {
    const gh = fakeGitHub();
    assert.equal(runIssue(event('issue-labeled-person'), opts(), fakeIo(), gh).outcome, 'nothing');
    const onPr = event('comment-approve-writer');
    onPr.issue.pull_request = { url: 'https://api.github.com/repos/o/r/pulls/12' };
    assert.equal(runIssue(onPr, opts(), fakeIo(), gh).outcome, 'nothing');
    assert.deepEqual(gh.calls, []);
  });

  it('a payload that is not an issue event fails without a GitHub call', () => {
    const gh = fakeGitHub();
    const result = runIssue({ action: 'opened' }, opts(), fakeIo(), gh);
    assert.equal(result.outcome, 'failed');
    assert.deepEqual(gh.calls, []);
  });
});

describe('commands before WP4', () => {
  it('a command gets one "not available yet" reply, updated in place, and nothing else', () => {
    const gh = fakeGitHub({ labels: ['approval-needed'], permissions: { maria: 'write' } });
    const result = runIssue(event('comment-approve-writer'), opts(), fakeIo(), gh);
    assert.equal(result.outcome, 'replied');
    runIssue(event('comment-approve-reader'), opts(), fakeIo(), gh);
    assert.equal(gh.state.comments.length, 1);
    const reply = gh.state.comments[0].body;
    assert.equal(parseMarker(reply).stage, 'ignored');
    assert.match(reply, /`\/approve` is not available yet/);
    assert.deepEqual(writes(gh), ['createComment', 'updateComment']);
    assert.deepEqual(gh.state.labels, ['approval-needed']);
  });
});

describe('agents issue --event (CLI)', () => {
  it('dry run: prints the verdict, writes the decision, never starts gh', () => {
    const decision = join(ROOT, DECISION);
    rmSync(decision, { force: true });
    const empty = mkdtempSync(join(tmpdir(), 'no-gh-'));
    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      [
        join(ROOT, 'tooling/agents/agents.mjs'),
        'issue',
        '--event',
        join(EVENTS, 'issue-opened-weak.json'),
        '--dry-run',
      ],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: empty, HOME: empty } }
    );
    assert.equal(status, 0, stderr);
    assert.match(stdout, /issue #12 gate: needs-detail/);
    assert.match(stdout, /^- Acceptance criteria: no Given\/When\/Then line$/m);
    assert.match(stdout, /dry run/);
    assert.ok(existsSync(decision));
    assert.equal(JSON.parse(readFileSync(decision, 'utf8')).label, 'needs-detail');
  });

  it('a missing payload is a usage error, not a crash', () => {
    const { status, stderr } = spawnSync(
      process.execPath,
      [join(ROOT, 'tooling/agents/agents.mjs'), 'issue', '--event', 'nope.json', '--dry-run'],
      { cwd: ROOT, encoding: 'utf8' }
    );
    assert.equal(status, 127);
    assert.match(stderr, /no event payload/);
  });
});
