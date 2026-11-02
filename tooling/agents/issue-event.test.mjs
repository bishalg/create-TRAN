// Verifies: REQ-ISS-001, REQ-ISS-011, REQ-ISS-019
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  COMMANDS,
  issueEventSignal,
  issueSettings,
  labelNames,
  ownedLabels,
  parseCommand,
  parseIssueEvent,
  parseMarker,
  renderIssueEvidence,
  renderMarker,
  runTask,
  SIGNALS,
  skipReason,
} from './agents.mjs';
import { EVENTS, event, fakeIo, ISSUE, OPTS, POLICY, ROOT } from './test-helpers.mjs';

describe('issue events (REQ-ISS-001)', () => {
  it('parses events (REQ-ISS-001)', () => {
    assert.deepEqual(parseIssueEvent(event('issue-opened-weak')), {
      kind: 'opened',
      action: 'opened',
      number: 12,
      title: 'Add country lookup',
      body: 'We need a lookup.',
      labels: ['bug'],
      author: { login: 'alice', type: 'User' },
      sender: { login: 'alice', type: 'User' },
      repo: 'o/r',
      isPullRequest: false,
      label: null,
      comment: null,
      command: null,
      commandText: null,
    });
    const approve = parseIssueEvent(event('comment-approve-writer'));
    assert.equal(approve.kind, 'commented');
    assert.equal(approve.command, 'approve');
    assert.equal(approve.commandText, 'looks right\nShip it.');
    assert.deepEqual(approve.comment, {
      id: 9001,
      body: '\n/approve looks right\nShip it.',
      author: { login: 'maria', type: 'User' },
      createdAt: '2026-11-02T09:00:00Z',
      url: 'https://github.com/o/r/issues/12#issuecomment-9001',
    });
    assert.equal(parseIssueEvent(event('issue-edited')).kind, 'edited');
    const labeled = parseIssueEvent(event('issue-labeled-runner'));
    assert.equal(labeled.kind, 'labeled');
    assert.equal(labeled.label, 'needs-detail');
  });

  it('never exposes author_association: permissions come from the API', () => {
    const parsed = parseIssueEvent(event('comment-approve-reader'));
    assert.ok(!JSON.stringify(parsed).includes('OWNER'));
  });

  it('an action it does not handle has no kind; a payload without an issue is an error', () => {
    assert.equal(parseIssueEvent({ ...event('issue-opened-weak'), action: 'closed' }).kind, null);
    const edited = { ...event('comment-approve-writer'), action: 'edited' };
    assert.equal(parseIssueEvent(edited).kind, null);
    assert.throws(() => parseIssueEvent({ action: 'opened' }), /not an issue event/);
    const pr = event('comment-no-command');
    pr.issue.pull_request = { url: 'x' };
    assert.equal(parseIssueEvent(pr).isPullRequest, true);
  });

  it('commands are the first non-blank line', () => {
    assert.deepEqual(COMMANDS, ['plan', 'approve', 'implement', 'review', 'screenshots']);
    assert.deepEqual(parseCommand('/approve'), { command: 'approve', commandText: '' });
    assert.deepEqual(parseCommand('\n  \n  /plan  keep it small \nmore'), {
      command: 'plan',
      commandText: 'keep it small \nmore',
    });
    for (const body of [
      'please /approve',
      '/approved',
      '/Approve',
      '/deploy now',
      'text\n/approve',
      '',
      null,
    ])
      assert.deepEqual(parseCommand(body), { command: null, commandText: null }, String(body));
    assert.equal(parseIssueEvent(event('comment-no-command')).command, null);
  });

  it('the marker round-trips and is recognised only at the start of a comment', () => {
    const marker = renderMarker({ stage: 'gate', verdict: 'ready', harness: 'fake' });
    assert.equal(marker, '<!-- tran-agent {"stage":"gate","verdict":"ready","harness":"fake"} -->');
    assert.deepEqual(parseMarker(`${marker}\nbody`), {
      stage: 'gate',
      verdict: 'ready',
      harness: 'fake',
    });
    assert.deepEqual(parseMarker(`\n  ${marker}`), parseMarker(marker));
    assert.equal(parseMarker(`quoted: ${marker}`), null);
    assert.equal(parseMarker('<!-- tran-agent {not json} -->'), null);
    assert.equal(parseMarker(null), null);
    assert.throws(() => renderMarker({ note: 'a --> b' }), /cannot hold "-->"/);
  });

  it('labels and issue settings default from the spec, the policy overrides them', () => {
    assert.deepEqual(ownedLabels({}), [
      'needs-detail',
      'approval-needed',
      'human-decision-needed',
      'review-needed',
      'good-to-merge',
      'agent:running',
      'agent:failed',
    ]);
    assert.deepEqual(ownedLabels(POLICY), ownedLabels({}));
    const renamed = labelNames({ labels: { 'needs-detail': 'triage: more detail' } });
    assert.equal(renamed['needs-detail'], 'triage: more detail');
    assert.equal(renamed['good-to-merge'], 'good-to-merge');
    const settings = issueSettings({});
    assert.equal(settings.applyRewrite, false);
    assert.equal(settings.autonomy.simple, 'plan-approve');
    assert.equal(settings.requireTests, true);
    assert.equal(settings.modelFor, 'collaborators');
    assert.equal(settings.ciFix.maxAttempts, 1);
    assert.deepEqual(issueSettings(POLICY), settings, 'the shipped policy states the defaults');
    assert.equal(
      issueSettings({ issues: { autonomy: { simple: 'auto' } } }).autonomy.simple,
      'auto'
    );
  });
});

describe('the runner never triggers itself (REQ-ISS-019)', () => {
  const quiet = {
    'comment-runner-marker': /the runner's own comment/,
    'comment-no-command': /no command/,
    'issue-labeled-runner': /label "needs-detail" is the runner's own/,
    'comment-bot': /sender github-actions\[bot\] is a bot/,
  };

  for (const [name, reason] of Object.entries(quiet))
    it(`${name}: exit 0 and the harness never starts (REQ-ISS-019)`, () => {
      const payload = event(name);
      assert.match(skipReason(parseIssueEvent(payload), POLICY), reason);
      const signal = issueEventSignal(payload, POLICY);
      assert.equal(signal.status, 0);
      assert.match(signal.output, reason);
      const io = fakeIo({ signal });
      const result = runTask(ISSUE, { ...OPTS, taskNames: ['issue'] }, io);
      assert.equal(result.outcome, 'no-signal');
      assert.equal(io.calls.harness, 0);
    });

  it('a bot is ignored even when it sends a command; a person-added label is work', () => {
    const bot = event('comment-approve-writer');
    bot.sender = { login: 'renovate[bot]', type: 'Bot' };
    assert.equal(issueEventSignal(bot, POLICY).status, 0);
    assert.equal(issueEventSignal(event('issue-labeled-person'), POLICY).status, 1);
    const renamed = { labels: { 'needs-detail': 'more-detail' } };
    assert.equal(issueEventSignal(event('issue-labeled-runner'), renamed).status, 1);
  });

  it('an unhandled action is nothing to do; a payload that is no issue event is broken', () => {
    assert.equal(
      issueEventSignal({ ...event('issue-opened-weak'), action: 'closed' }, POLICY).status,
      0
    );
    assert.equal(issueEventSignal({ action: 'opened' }, POLICY).status, 127);
  });

  it('opened, edited and a command by a person are work, marked as untrusted evidence', () => {
    for (const name of ['issue-opened-weak', 'issue-edited', 'comment-approve-writer']) {
      const signal = issueEventSignal(event(name), POLICY);
      assert.equal(signal.status, 1, name);
      assert.equal(signal.untrusted, true);
      assert.match(signal.output, /Add country lookup/);
    }
  });

  it('the built-in signal reads AGENT_EVENT, then GITHUB_EVENT_PATH, and is broken without one', () => {
    const saved = { a: process.env.AGENT_EVENT, g: process.env.GITHUB_EVENT_PATH };
    try {
      delete process.env.AGENT_EVENT;
      delete process.env.GITHUB_EVENT_PATH;
      assert.equal(SIGNALS['issue-event'](ROOT, POLICY).status, 127);
      process.env.GITHUB_EVENT_PATH = join(EVENTS, 'comment-bot.json');
      assert.equal(SIGNALS['issue-event'](ROOT, POLICY).status, 0);
      process.env.AGENT_EVENT = join(EVENTS, 'issue-opened-weak.json');
      const work = SIGNALS['issue-event'](ROOT, POLICY);
      assert.equal(work.status, 1);
      assert.equal(work.untrusted, true);
      process.env.AGENT_EVENT = join(EVENTS, 'missing.json');
      assert.match(SIGNALS['issue-event'](ROOT, POLICY).output, /no event payload/);
    } finally {
      for (const [key, value] of [
        ['AGENT_EVENT', saved.a],
        ['GITHUB_EVENT_PATH', saved.g],
      ])
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
  });

  it('`agents signal issue-event --event <path>` reads the payload it is given', () => {
    const cli = (fixture) =>
      spawnSync(
        process.execPath,
        ['tooling/agents/agents.mjs', 'signal', 'issue-event', '--event', join(EVENTS, fixture)],
        { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: '' } }
      );
    const work = cli('issue-opened-weak.json');
    assert.equal(work.status, 1);
    assert.match(work.stdout, /Issue #12 in o\/r: Add country lookup/);
    const own = cli('comment-runner-marker.json');
    assert.equal(own.status, 0);
    assert.match(own.stdout, /nothing to do/);
  });
});

describe('issue evidence (REQ-ISS-011)', () => {
  const comments = [
    { id: 1, body: 'first', user: { login: 'bob', type: 'User' } },
    { id: 2, body: 'second\nline', author: { login: 'carol', type: 'User' } },
  ];

  it('renders the issue, its labels, the event and every comment as plain text', () => {
    const text = renderIssueEvidence(parseIssueEvent(event('comment-approve-writer')), comments);
    for (const expected of [
      'Issue #12 in o/r: Add country lookup',
      'Author: @alice · Labels: approval-needed',
      'Event: commented by @maria (command: /approve)',
      '--- Issue body ---',
      'As a voter',
      '--- Comment 1 by @bob (id 1) ---\nfirst',
      '--- Comment 2 by @carol (id 2) ---\nsecond\nline',
      '--- Comment 3 by @maria (id 9001) ---',
      'Ship it.',
    ])
      assert.ok(text.includes(expected), `evidence is missing: ${expected}`);
  });

  it('does not repeat the triggering comment when it is already listed', () => {
    const parsed = parseIssueEvent(event('comment-approve-writer'));
    const text = renderIssueEvidence(parsed, [...comments, { ...parsed.comment }]);
    assert.equal(text.match(/id 9001/g).length, 1);
  });

  it('drops the oldest comments first to fit the line budget, and says so', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      body: `comment ${i + 1}`,
      user: { login: 'bob' },
    }));
    const text = renderIssueEvidence(parseIssueEvent(event('issue-opened-weak')), many, {
      maxLines: 20,
    });
    assert.ok(text.split('\n').length <= 20, text);
    assert.match(text, /older comments omitted/);
    assert.match(text, /comment 30/);
    assert.doesNotMatch(text, /comment 1\n/);
    assert.match(text, /We need a lookup\./);
  });

  it('an empty body and an issue without labels still render', () => {
    const payload = event('issue-opened-weak');
    payload.issue.body = null;
    payload.issue.labels = [];
    const text = renderIssueEvidence(parseIssueEvent(payload));
    assert.match(text, /Labels: none/);
    assert.match(text, /--- Issue body ---\n\(empty\)/);
  });

  it('a temp fixture copy can feed the signal too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'issue-event-'));
    const path = join(dir, 'event.json');
    writeFileSync(path, JSON.stringify(event('issue-opened-complete')));
    const saved = process.env.AGENT_EVENT;
    process.env.AGENT_EVENT = path;
    try {
      assert.match(SIGNALS['issue-event'](ROOT, POLICY).output, /REQ-RULE-009/);
    } finally {
      if (saved === undefined) delete process.env.AGENT_EVENT;
      else process.env.AGENT_EVENT = saved;
    }
  });
});
