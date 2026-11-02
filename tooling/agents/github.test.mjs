// The one GitHub client of the issue-driven stages (spec 020, ADR-0037 D4) and its fake.
// Verifies: REQ-ISS-024
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGitHubClient, fakeGitHub, PERMISSIONS } from './agents.mjs';

const TOKEN = 'fake-token-do-not-print-123'; // not a real token shape: secret scanners flag ghp_ prefixes

/** A spawn stub: answers each call from `replies` in order and records what was spawned. */
function stub(replies = []) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, input: options.input, env: options.env, cwd: options.cwd });
    const reply = replies.length ? replies.shift() : {};
    return { status: 0, stdout: '', stderr: '', ...reply };
  };
  return { calls, spawn };
}
const client = (replies) => {
  const s = stub(replies);
  return { ...s, gh: createGitHubClient({ repo: 'o/r', spawn: s.spawn, cwd: '/repo' }) };
};
const ok = (value) => ({ stdout: JSON.stringify(value) });
const lines = (values) => ({ stdout: values.map((v) => JSON.stringify(v)).join('\n') + '\n' });
const api = (method, path, ...rest) => ['api', '--method', method, path, ...rest];
const PAGED = ['--paginate', '--jq', '.[]'];

describe('the live GitHub client (gh api underneath)', () => {
  it('each method is one gh api call with its documented method and path', () => {
    const cases = [
      [
        (gh) => gh.getIssue(12),
        api('GET', 'repos/o/r/issues/12'),
        ok({
          number: 12,
          title: 'T',
          body: null,
          labels: [{ name: 'bug' }],
          user: { login: 'alice', type: 'User' },
          state: 'open',
        }),
        {
          number: 12,
          title: 'T',
          body: '',
          labels: ['bug'],
          author: { login: 'alice', type: 'User' },
          state: 'open',
          isPullRequest: false,
        },
      ],
      [
        (gh) => gh.listComments(12),
        api('GET', 'repos/o/r/issues/12/comments?per_page=100', ...PAGED),
        lines([
          {
            id: 1,
            body: 'a\nb',
            user: { login: 'bob', type: 'User' },
            created_at: 't1',
            html_url: 'u1',
          },
          { id: 2, body: 'c', user: null, created_at: 't2', html_url: 'u2' },
        ]),
        [
          {
            id: 1,
            body: 'a\nb',
            author: { login: 'bob', type: 'User' },
            createdAt: 't1',
            url: 'u1',
          },
          {
            id: 2,
            body: 'c',
            author: { login: 'ghost', type: 'User' },
            createdAt: 't2',
            url: 'u2',
          },
        ],
      ],
      [
        (gh) => gh.createComment(12, 'hello'),
        api('POST', 'repos/o/r/issues/12/comments', '--input', '-'),
        ok({ id: 7, html_url: 'u7' }),
        { id: 7, url: 'u7' },
      ],
      [
        (gh) => gh.updateComment(7, 'again'),
        api('PATCH', 'repos/o/r/issues/comments/7', '--input', '-'),
        ok({ id: 7, html_url: 'u7' }),
        { id: 7, url: 'u7' },
      ],
      [
        (gh) => gh.getLabels(12),
        api('GET', 'repos/o/r/issues/12/labels?per_page=100', ...PAGED),
        lines([{ name: 'bug' }, { name: 'needs-detail' }]),
        ['bug', 'needs-detail'],
      ],
      [
        (gh) => gh.setLabels(12, ['bug', 'approval-needed']),
        api('PUT', 'repos/o/r/issues/12/labels', '--input', '-'),
        ok([{ name: 'bug' }, { name: 'approval-needed' }]),
        ['bug', 'approval-needed'],
      ],
      [
        (gh) => gh.permission('maria'),
        api('GET', 'repos/o/r/collaborators/maria/permission'),
        ok({ permission: 'write', role_name: 'maintain' }),
        'maintain',
      ],
      [
        (gh) => gh.listOpenPrs(),
        api('GET', 'repos/o/r/pulls?state=open&per_page=100', ...PAGED),
        lines([
          {
            number: 3,
            html_url: 'p3',
            title: 'x',
            draft: true,
            head: { ref: 'agent/issue-12-x', repo: { full_name: 'o/r' } },
          },
        ]),
        [
          {
            number: 3,
            url: 'p3',
            title: 'x',
            draft: true,
            headRefName: 'agent/issue-12-x',
            headRepo: 'o/r',
          },
        ],
      ],
      [
        (gh) =>
          gh.createPr({ head: 'agent/issue-12-x', base: 'dev', title: 't', body: 'Closes #12' }),
        api('POST', 'repos/o/r/pulls', '--input', '-'),
        ok({ number: 3, html_url: 'p3' }),
        { number: 3, url: 'p3' },
      ],
      [
        (gh) => gh.updatePr(3, { body: 'Closes #12\nmore' }),
        api('PATCH', 'repos/o/r/pulls/3', '--input', '-'),
        ok({ number: 3, html_url: 'p3' }),
        { number: 3, url: 'p3' },
      ],
    ];
    for (const [call, args, reply, expected] of cases) {
      const { gh, calls } = client([reply]);
      assert.deepEqual(call(gh), expected, args.join(' '));
      assert.equal(calls.length, 1, args.join(' '));
      assert.equal(calls[0].command, 'gh');
      assert.deepEqual(calls[0].args, args);
      assert.equal(calls[0].cwd, '/repo');
    }
  });

  it('sends request bodies as JSON on stdin, never as arguments', () => {
    const { gh, calls } = client([ok({}), ok({}), ok([]), ok({}), ok({})]);
    gh.createComment(12, 'a "quoted" body\n--flag');
    gh.updateComment(7, 'b');
    gh.setLabels(12, ['bug']);
    gh.createPr({ head: 'h', base: 'dev', title: 't', body: 'b' });
    gh.updatePr(3, { title: 't2' });
    assert.deepEqual(
      calls.map((c) => JSON.parse(c.input)),
      [
        { body: 'a "quoted" body\n--flag' },
        { body: 'b' },
        { labels: ['bug'] },
        { head: 'h', base: 'dev', title: 't', body: 'b', draft: true },
        { title: 't2' },
      ]
    );
  });

  it('ensureLabels creates each missing label and treats "already exists" (422) as done', () => {
    const exists = {
      status: 1,
      stdout: '{"errors":[{"code":"already_exists"}]}',
      stderr: 'gh: Validation Failed (HTTP 422)',
    };
    const { gh, calls } = client([ok({ name: 'needs-detail' }), exists]);
    assert.deepEqual(gh.ensureLabels(['needs-detail', 'bug']), ['needs-detail']);
    assert.deepEqual(
      calls.map((c) => [c.args, JSON.parse(c.input).name]),
      [
        [api('POST', 'repos/o/r/labels', '--input', '-'), 'needs-detail'],
        [api('POST', 'repos/o/r/labels', '--input', '-'), 'bug'],
      ]
    );
    const other = client([{ status: 1, stderr: 'gh: Forbidden (HTTP 403)' }]);
    assert.throws(() => other.gh.ensureLabels(['x']), /HTTP 403/);
  });

  it('permission is the role name; someone who is not a collaborator has none', () => {
    assert.equal(
      client([ok({ permission: 'read', role_name: 'triage' })]).gh.permission('t'),
      'triage'
    );
    assert.equal(client([ok({ permission: 'admin' })]).gh.permission('a'), 'admin');
    assert.equal(
      client([{ status: 1, stderr: 'gh: Not Found (HTTP 404)' }]).gh.permission('x'),
      'none'
    );
    assert.equal(client([ok({ role_name: 'superuser' })]).gh.permission('x'), 'none');
    assert.deepEqual(PERMISSIONS, ['admin', 'maintain', 'write', 'triage', 'read', 'none']);
  });

  it('pushBranch is one git push of that branch to origin', () => {
    const { gh, calls } = client([{}]);
    gh.pushBranch('agent/issue-12-x');
    assert.deepEqual(
      calls.map((c) => [c.command, c.args]),
      [['git', ['push', '-u', 'origin', 'agent/issue-12-x']]]
    );
  });

  it('rejects values that would change the request path', () => {
    const { gh, calls } = client();
    assert.throws(() => createGitHubClient({ repo: 'o/r/../x', spawn: () => ({}) }), /owner\/name/);
    assert.throws(() => gh.getIssue('12/../../x'), /issue number/);
    assert.throws(() => gh.updateComment(-1, 'x'), /comment id/);
    assert.throws(() => gh.permission('a/b'), /login/);
    assert.throws(() => gh.pushBranch('--force'), /branch/);
    assert.equal(calls.length, 0);
  });

  it('never prints the token: not in arguments, and redacted from errors', () => {
    const s = stub([{ status: 1, stderr: `bad credentials for ${TOKEN}`, stdout: '' }]);
    const gh = createGitHubClient({ repo: 'o/r', spawn: s.spawn, env: { GH_TOKEN: TOKEN } });
    let message = '';
    try {
      gh.getIssue(12);
    } catch (error) {
      message = error.message;
    }
    assert.match(message, /gh api GET repos\/o\/r\/issues\/12 failed \(exit 1\)/);
    assert.ok(!message.includes(TOKEN), message);
    assert.match(message, /\*\*\*/);
    assert.ok(!s.calls.some((c) => c.args.join(' ').includes(TOKEN)));
    assert.equal(s.calls[0].env.GH_TOKEN, TOKEN, 'the token reaches gh only through its env');
  });

  it("whoami is the runner's identity, asked once (REQ-ISS-024)", () => {
    const { calls, gh } = client([ok({ login: 'tran-bot', type: 'User' })]);
    assert.equal(gh.whoami(), 'tran-bot');
    assert.equal(gh.whoami(), 'tran-bot');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, api('GET', 'user'));

    // The job token cannot read /user (HTTP 403): the comments are the Actions bot's.
    const job = client([
      { status: 1, stderr: 'gh: Resource not accessible by integration (HTTP 403)' },
    ]);
    assert.equal(job.gh.whoami(), 'github-actions[bot]');

    // A GitHub App token names its bot login in AGENT_GITHUB_LOGIN; no call is needed.
    const s = stub();
    const app = createGitHubClient({
      repo: 'o/r',
      spawn: s.spawn,
      env: { AGENT_GITHUB_LOGIN: 'tran-app[bot]' },
    });
    assert.equal(app.whoami(), 'tran-app[bot]');
    assert.equal(s.calls.length, 0);
    assert.throws(
      () => createGitHubClient({ repo: 'o/r', spawn: s.spawn, env: { AGENT_GITHUB_LOGIN: 'a b' } }),
      /AGENT_GITHUB_LOGIN/
    );
    const broken = client([{ status: 1, stderr: 'HTTP 500' }]);
    assert.throws(() => broken.gh.whoami(), /HTTP 500/);
  });

  it('a missing gh is a clear error', () => {
    const gh = createGitHubClient({
      repo: 'o/r',
      spawn: () => ({ status: null, error: Object.assign(new Error('x'), { code: 'ENOENT' }) }),
    });
    assert.throws(() => gh.getLabels(1), /gh is not installed/);
  });
});

describe('the fake GitHub client', () => {
  const methods = (object) =>
    Object.keys(object)
      .filter((key) => typeof object[key] === 'function')
      .sort();

  it('the fake mirrors the live surface', () => {
    const live = createGitHubClient({ repo: 'o/r', spawn: () => ({}) });
    assert.deepEqual(methods(fakeGitHub()), methods(live));
    assert.equal(methods(live).length, 13);
  });

  it('serves state, applies writes and records every call', () => {
    const gh = fakeGitHub({
      issue: { number: 12, title: 'T', body: 'B', author: { login: 'alice', type: 'User' } },
      comments: [{ id: 1, body: 'hi', author: { login: 'bob', type: 'User' } }],
      labels: ['bug', 'needs-detail'],
      permissions: { maria: 'write' },
      repoLabels: ['bug'],
    });
    assert.equal(gh.getIssue(12).title, 'T');
    assert.deepEqual(gh.getIssue(12).labels, ['bug', 'needs-detail']);
    const created = gh.createComment(12, 'marker');
    assert.equal(gh.listComments(12).length, 2);
    gh.updateComment(created.id, 'updated');
    assert.equal(gh.listComments(12).at(-1).body, 'updated');
    assert.throws(() => gh.updateComment(424242, 'x'), /no comment 424242/);
    assert.deepEqual(gh.setLabels(12, ['bug', 'approval-needed']), ['bug', 'approval-needed']);
    assert.deepEqual(gh.getLabels(12), ['bug', 'approval-needed']);
    assert.deepEqual(gh.ensureLabels(['bug', 'approval-needed']), ['approval-needed']);
    assert.deepEqual(gh.state.repoLabels, ['bug', 'approval-needed']);
    assert.equal(gh.permission('maria'), 'write');
    assert.equal(gh.permission('rick'), 'none');
    const pr = gh.createPr({
      head: 'agent/issue-12-x',
      base: 'dev',
      title: 't',
      body: 'Closes #12',
    });
    assert.deepEqual(
      gh.listOpenPrs().map((p) => p.headRefName),
      ['agent/issue-12-x']
    );
    gh.updatePr(pr.number, { body: 'Closes #12\nv2' });
    assert.equal(gh.state.prs[0].body, 'Closes #12\nv2');
    gh.pushBranch('agent/issue-12-x');
    assert.deepEqual(gh.state.pushed, ['agent/issue-12-x']);
    assert.deepEqual(
      gh.calls.map((c) => c.method),
      [
        'getIssue',
        'getIssue',
        'createComment',
        'listComments',
        'updateComment',
        'listComments',
        'updateComment',
        'setLabels',
        'getLabels',
        'ensureLabels',
        'permission',
        'permission',
        'createPr',
        'listOpenPrs',
        'updatePr',
        'pushBranch',
      ]
    );
    assert.deepEqual(gh.calls[2].args, [12, 'marker']);
  });

  it("the fake's own comments are by its login (REQ-ISS-024)", () => {
    const gh = fakeGitHub({ login: 'tran-bot' });
    assert.equal(gh.whoami(), 'tran-bot');
    gh.createComment(1, 'x');
    assert.equal(gh.listComments(1)[0].author.login, 'tran-bot');
    assert.equal(fakeGitHub().whoami(), 'runner');
  });

  it('starts empty and keeps callers from mutating its state through return values', () => {
    const gh = fakeGitHub();
    assert.deepEqual(gh.listComments(1), []);
    assert.deepEqual(gh.getLabels(1), []);
    gh.getLabels(1).push('x');
    assert.deepEqual(gh.getLabels(1), []);
  });
});
