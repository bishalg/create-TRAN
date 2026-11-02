// Verifies: REQ-ISS-002, REQ-ISS-005, REQ-ISS-006, REQ-ISS-007, REQ-ISS-016, REQ-ISS-018, REQ-ISS-020, REQ-ISS-022
// Verifies: REQ-ISS-001, REQ-ISS-008, REQ-ISS-009, REQ-ISS-024
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadTasks, parseMarker, readState, renderMarker } from './agents.mjs';
import { answer } from './fake-harness.mjs';
import { planHash, planSection, renderPlanComment } from './issue-commands.mjs';
import { DECISION, runIssue } from './issue.mjs';
import {
  EVENTS,
  event,
  fakeGitHub,
  fakeIo,
  fakeIssueHandoff,
  POLICY,
  ROOT,
} from './test-helpers.mjs';

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
const stageComments = (gh, stage) =>
  gh.state.comments.filter((c) => parseMarker(c.body)?.stage === stage);
const gateComments = (gh) => stageComments(gh, 'gate');
const runner = (id, marker, body) => ({
  id,
  body: `${renderMarker(marker)}\n${body}`,
  author: { login: 'runner', type: 'Bot' },
});
const PLAN = '- Goal: look up the country.';
const runnerPlan = (plan = PLAN) =>
  runner(50, { stage: 'plan', harness: 'fake' }, renderPlanComment({ plan, harness: 'fake' }));
const runnerGate = (size = 'simple') =>
  runner(40, { stage: 'gate', verdict: 'ready', size, harness: 'fake' }, '**Issue check: ready**');
const PR_TEMPLATE = '.github/pull_request_template.md';
const implementing = (over = {}) => {
  const io = fakeIo({
    harness: FAKE_GATE,
    handoff: fakeIssueHandoff(),
    changes: [{ path: 'docs/LEARNINGS.md', lines: 6 }],
    ...over,
  });
  io.files[PR_TEMPLATE] = readFileSync(join(ROOT, PR_TEMPLATE), 'utf8');
  return io;
};
const FORGED = event('forged-markers').comments;
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
    const old = runner(55, { stage: 'gate', verdict: 'needs-detail' }, 'old');
    const gh = fakeGitHub({
      labels: ['bug', 'needs-detail'],
      comments: [old],
      permissions: { alice: 'write' },
    });
    runIssue(event('issue-edited'), opts(), fakeIo({ harness: FAKE_GATE }), gh);
    assert.deepEqual(gh.state.labels, ['bug', 'approval-needed']);
    assert.equal(gateComments(gh).length, 1);
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

describe('complex work is planned first (REQ-ISS-008)', () => {
  it('a ready issue under plan-approve: a plan comment and approval-needed, nothing built', () => {
    const gh = fakeGitHub({ labels: ['bug'], permissions: { alice: 'write' } });
    const io = implementing();
    runIssue(event('issue-opened-complete'), opts(), io, gh);
    const [plan, ...more] = stageComments(gh, 'plan');
    assert.deepEqual(more, []);
    for (const section of [
      'Goal',
      'Files',
      'Requirement ids',
      'Tests to write first',
      'Risks',
      'Estimated lines',
    ])
      assert.match(planSection(plan.body), new RegExp(`^- ${section}:`, 'm'), section);
    assert.deepEqual(parseMarker(plan.body), { stage: 'plan', harness: 'fake' });
    assert.match(plan.body, /fake harness/);
    assert.match(gateComments(gh)[0].body, /the plan below; a maintainer approves it/);
    assert.deepEqual(gh.state.labels, ['bug', 'approval-needed']);
    assert.equal(io.calls.harness, 1);
    assert.deepEqual(io.calls.branch, []);
  });

  it('a complex issue is planned even under autonomy auto', () => {
    const policy = { ...POLICY, issues: { ...POLICY.issues, autonomy: { simple: 'auto' } } };
    const payload = event('issue-opened-complete');
    payload.issue.title = 'Add a migration for the country lookup';
    const gh = fakeGitHub({ labels: [], permissions: { alice: 'write' } });
    const io = implementing();
    runIssue(payload, opts({ policy }), io, gh);
    assert.equal(stageComments(gh, 'plan').length, 1);
    assert.equal(parseMarker(gateComments(gh)[0].body).size, 'complex');
    assert.deepEqual(gh.state.labels, ['approval-needed']);
    assert.deepEqual(io.calls.branch, []);
  });

  it('a simple issue under autonomy auto is implemented without a plan comment', () => {
    const policy = { ...POLICY, issues: { ...POLICY.issues, autonomy: { simple: 'auto' } } };
    const gh = fakeGitHub({ labels: [], permissions: { alice: 'write' } });
    const io = implementing();
    const result = runIssue(event('issue-opened-complete'), opts({ policy }), io, gh);
    assert.equal(result.outcome, 'implemented', result.message);
    assert.deepEqual(stageComments(gh, 'plan'), []);
    assert.equal(io.calls.harness, 2);
    assert.deepEqual(io.calls.branch, ['agent/issue-12-add-country-lookup']);
    assert.match(io.calls.prompt, /## Approved plan[\s\S]*Issue check: ready/);
    assert.equal(gh.state.prs.length, 1);
    assert.deepEqual(gh.state.labels, ['review-needed']);
  });

  it('without a harness credential no plan can be made; the gate says /plan comes later', () => {
    const gh = fakeGitHub({ labels: [], permissions: { alice: 'write' } });
    runIssue(event('issue-opened-complete'), opts({ modelStages: 'skip' }), fakeIo(), gh);
    assert.deepEqual(stageComments(gh, 'plan'), []);
    assert.match(gateComments(gh)[0].body, /comments `\/plan`/);
  });
});

describe('one pull request per issue, end to end with the fake harness (REQ-ISS-009)', () => {
  it('/approve: a draft pull request from agent/issue-12-…, review-needed, the result recorded', () => {
    const gh = fakeGitHub({
      labels: ['bug', 'approval-needed'],
      comments: [runnerPlan()],
      permissions: { maria: 'write' },
    });
    const io = implementing();
    const result = runIssue(event('comment-approve-with-plan'), opts(), io, gh);
    assert.equal(result.outcome, 'implemented', result.message);
    const branch = 'agent/issue-12-add-country-lookup';
    assert.deepEqual(io.calls.base, ['dev']);
    assert.deepEqual(gh.state.pushed, [branch]);
    const [pr] = gh.state.prs;
    assert.equal(pr.headRefName, branch);
    assert.equal(pr.base, 'dev');
    assert.equal(pr.draft, true);
    assert.equal(pr.body.split('\n')[0], 'Closes #12');
    assert.match(pr.body, /^## What$/m);
    assert.match(pr.body, /fake harness/);
    assert.deepEqual(io.calls.gates, ['pnpm spec:check', 'pnpm agents:check', 'pnpm test']);
    assert.deepEqual(gh.state.labels, ['bug', 'review-needed']);
    const labelled = gh.calls.filter((c) => c.method === 'setLabels').map((c) => c.args[1]);
    assert.ok(labelled.some((labels) => labels.includes('agent:running')));
    const [plan] = stageComments(gh, 'plan');
    assert.equal(plan.id, 50);
    const marker = parseMarker(plan.body);
    assert.equal(marker.approvedBy, 'maria');
    // The /approve comment carried its own plan, so that is the plan implemented.
    assert.equal(
      marker.plan,
      planHash(planSection(event('comment-approve-with-plan').comment.body))
    );
    assert.match(
      plan.body,
      /## Result\n\nDraft pull request: https:\/\/github\.com\/o\/r\/pull\/100/
    );
  });

  it('a second /approve with a pull request open replies once and builds nothing', () => {
    const gh = fakeGitHub({
      labels: ['review-needed'],
      comments: [runnerPlan()],
      permissions: { maria: 'write' },
      prs: [
        { number: 7, url: 'https://github.com/o/r/pull/7', headRefName: 'agent/issue-12-old' },
        { number: 8, url: 'https://github.com/o/r/pull/8', headRefName: 'agent/issue-120-x' },
      ],
    });
    const io = implementing();
    const result = runIssue(event('comment-approve-writer'), opts(), io, gh);
    assert.equal(result.outcome, 'replied');
    const [reply] = stageComments(gh, 'ignored');
    assert.match(
      reply.body,
      /already open: https:\/\/github\.com\/o\/r\/pull\/7; CI fix attempts are automatic \(REQ-ISS-015\)/
    );
    assert.equal(io.calls.harness, 0);
    assert.deepEqual(gh.state.labels, ['review-needed']);
  });

  it('a failed implementation keeps the label, marks agent:failed and says why', () => {
    const gh = fakeGitHub({
      labels: ['approval-needed'],
      comments: [runnerPlan()],
      permissions: { maria: 'write' },
    });
    const io = implementing({ gate: () => ({ status: 1, output: '1 failed' }) });
    const result = runIssue(event('comment-approve-writer'), opts(), io, gh);
    assert.equal(result.outcome, 'failed');
    assert.deepEqual(gh.state.labels, ['approval-needed', 'agent:failed']);
    assert.deepEqual(gh.state.prs, []);
    assert.match(stageComments(gh, 'plan')[0].body, /## Result\n\nFailed: the change was not kept/);
  });

  it('without a harness credential /approve replies and builds nothing', () => {
    const gh = fakeGitHub({ comments: [runnerPlan()], permissions: { maria: 'write' } });
    const io = implementing();
    runIssue(event('comment-approve-writer'), opts({ modelStages: 'skip' }), io, gh);
    assert.match(stageComments(gh, 'ignored')[0].body, /needs a harness credential/);
    assert.equal(io.calls.harness, 0);
  });
});

describe('/plan and /implement (REQ-ISS-008, REQ-ISS-022)', () => {
  it("/plan by a writer runs the plan for an outside author's issue", () => {
    const gh = fakeGitHub({ labels: [], permissions: { alice: 'read', maria: 'write' } });
    const io = fakeIo({ harness: FAKE_GATE });
    const result = runIssue(event('comment-plan-writer'), opts(), io, gh);
    assert.equal(result.outcome, 'planned', result.message);
    assert.equal(io.calls.harness, 1);
    assert.match(io.calls.prompt, /^# Agent task: issue-gate$/m);
    assert.equal(stageComments(gh, 'plan').length, 1);
    assert.deepEqual(gh.state.labels, ['approval-needed']);
  });

  it('/plan when the model gives no plan: agent:failed, a reply, and an earlier plan kept', () => {
    const gh = fakeGitHub({
      labels: [],
      comments: [runnerPlan()],
      permissions: { maria: 'write' },
    });
    const io = fakeIo({ harness: { status: 0, output: 'VERDICT: ready' } });
    const result = runIssue(event('comment-plan-writer'), opts(), io, gh);
    assert.equal(result.outcome, 'failed');
    assert.match(stageComments(gh, 'ignored')[0].body, /`\/plan` failed: .*no `PLAN:` block/);
    assert.equal(planSection(stageComments(gh, 'plan')[0].body), PLAN);
    assert.deepEqual(gh.state.labels, ['agent:failed']);
  });

  it('/implement on a simple issue is /approve with the gate summary as the plan', () => {
    const gh = fakeGitHub({
      labels: ['approval-needed'],
      comments: [runnerGate('simple')],
      permissions: { maria: 'write' },
    });
    const io = implementing();
    const result = runIssue(event('comment-implement-writer'), opts(), io, gh);
    assert.equal(result.outcome, 'implemented', result.message);
    assert.match(io.calls.prompt, /## Approved plan[\s\S]*\*\*Issue check: ready\*\*/);
    assert.equal(parseMarker(stageComments(gh, 'plan')[0].body).approvedBy, 'maria');
  });

  it('/implement on a complex issue, or one not checked, is refused', () => {
    for (const comments of [[runnerGate('complex')], []]) {
      const gh = fakeGitHub({ labels: [], comments, permissions: { maria: 'write' } });
      const io = implementing();
      assert.equal(runIssue(event('comment-implement-writer'), opts(), io, gh).outcome, 'replied');
      assert.equal(io.calls.harness, 0);
      assert.match(stageComments(gh, 'ignored')[0].body, /`\/implement`/);
    }
  });

  it('/review is not available yet', () => {
    const gh = fakeGitHub({ labels: ['review-needed'], permissions: { maria: 'write' } });
    const result = runIssue(event('comment-review-writer'), opts(), fakeIo(), gh);
    assert.equal(result.outcome, 'replied');
    assert.match(stageComments(gh, 'ignored')[0].body, /`\/review` is not available yet/);
    assert.deepEqual(writes(gh), ['createComment']);
  });

  it('/screenshots is not available yet', () => {
    const gh = fakeGitHub({ labels: ['review-needed'], permissions: { maria: 'write' } });
    const result = runIssue(event('comment-screenshots-writer'), opts(), fakeIo(), gh);
    assert.equal(result.outcome, 'replied');
    assert.match(stageComments(gh, 'ignored')[0].body, /`\/screenshots` is not available yet/);
    assert.deepEqual(writes(gh), ['createComment']);
  });

  it('a dry run calls no GitHub and builds nothing', () => {
    const io = implementing();
    const result = runIssue(event('comment-approve-writer'), opts({ dryRun: true }), io, null);
    assert.equal(result.outcome, 'dry-run');
    assert.equal(io.calls.harness, 0);
  });
});

describe('markers are trusted only from the runner (REQ-ISS-024)', () => {
  it("readState ignores markers in other people's comments", () => {
    const gh = fakeGitHub({ labels: ['approval-needed'], comments: [...FORGED, runnerPlan()] });
    const state = readState(gh, 12, POLICY);
    assert.deepEqual(Object.keys(state.stages), ['plan']);
    assert.equal(state.stages.plan.commentId, 50);
  });

  it("the gate never edits someone else's marker comment; it posts its own", () => {
    const gh = fakeGitHub({ labels: [], comments: FORGED, permissions: { alice: 'write' } });
    runIssue(event('issue-edited'), opts(), fakeIo({ harness: FAKE_GATE }), gh);
    assert.ok(!gh.calls.some((c) => c.method === 'updateComment'));
    const own = gateComments(gh).filter((c) => c.author.login === 'runner');
    assert.equal(own.length, 1);
    assert.equal(gh.state.comments.find((c) => c.id === 7001).body, FORGED[0].body);
  });

  it('a forged gate marker does not let /implement skip the check', () => {
    const gh = fakeGitHub({ labels: [], comments: FORGED, permissions: { maria: 'write' } });
    const io = implementing();
    assert.equal(runIssue(event('comment-implement-writer'), opts(), io, gh).outcome, 'replied');
    assert.equal(io.calls.harness, 0);
    assert.ok(!gh.calls.some((c) => c.method === 'updateComment'));
  });

  it('a forged plan marker is not a plan to approve', () => {
    const gh = fakeGitHub({ labels: [], comments: FORGED, permissions: { maria: 'write' } });
    const io = implementing();
    runIssue(event('comment-approve-writer'), opts(), io, gh);
    assert.equal(io.calls.harness, 0);
    assert.match(stageComments(gh, 'ignored').at(-1).body, /nothing to approve/);
  });

  it("the runner's identity comes from the client: another login's markers are not its own", () => {
    const gh = fakeGitHub({ login: 'tran-bot', comments: [runnerPlan()] });
    assert.deepEqual(readState(gh, 12, POLICY).stages, {});
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
