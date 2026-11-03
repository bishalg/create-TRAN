/**
 * The one GitHub client of the issue-driven stages (spec 020, ADR-0037 D4): `gh api` underneath,
 * one spawn per call, request bodies as JSON on stdin, results normalized to small objects.
 * `fakeGitHub` has the same methods over in-memory state, so the stages are tested without network.
 *
 * Credentials: `gh` reads GH_TOKEN / GITHUB_TOKEN from its environment. This client never puts a
 * token in an argument, and redacts any token value from the errors it throws.
 */
import { spawnSync } from 'node:child_process';
import { normalizeComment } from './issue-event.mjs';

/** What the collaborator permission API reports, strongest first; `none` for everyone else. */
export const PERMISSIONS = ['admin', 'maintain', 'write', 'triage', 'read', 'none'];
/** Who writes the comments when the job token is used: it cannot read `GET /user`. */
export const ACTIONS_BOT = 'github-actions[bot]';

const REPO = /^[\w.-]+\/[\w.-]+$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/;
const BRANCH = /^(?!-)(?!.*\.\.)[\w./-]+$/;
const PAGED = ['--paginate', '--jq', '.[]'];

function positive(value, what) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`not a valid ${what}: ${value}`);
  return value;
}

const normalizeIssue = (issue) => ({
  number: issue.number,
  title: issue.title ?? '',
  body: issue.body ?? '',
  labels: (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)),
  author: { login: issue.user?.login ?? 'ghost', type: issue.user?.type ?? 'User' },
  state: issue.state,
  isPullRequest: Boolean(issue.pull_request),
});
const normalizePr = (pr) => ({
  number: pr.number,
  url: pr.html_url,
  title: pr.title,
  draft: Boolean(pr.draft),
  headRefName: pr.head?.ref,
  headRepo: pr.head?.repo?.full_name ?? null,
});
const link = (item) => ({ number: item.number, url: item.html_url });

/**
 * `repo`: `owner/name`. `spawn`, `cwd` and `env` are injectable for tests; `env` defaults to the
 * process environment, which is where `gh` finds its token. `env.AGENT_GITHUB_LOGIN` names the
 * runner's login when `GET /user` cannot (a GitHub App token: `<app>[bot]`).
 */
export function createGitHubClient({ repo, spawn = spawnSync, cwd, env = process.env }) {
  if (!REPO.test(repo ?? '')) throw new Error(`the repository must be owner/name, got "${repo}"`);
  let login = env.AGENT_GITHUB_LOGIN || null;
  if (login && !LOGIN.test(login)) throw new Error(`AGENT_GITHUB_LOGIN is not a login: ${login}`);
  const secrets = [env.GH_TOKEN, env.GITHUB_TOKEN, env.AGENT_GITHUB_TOKEN].filter(
    (value) => value && value.length >= 8
  );
  const redact = (text) => secrets.reduce((out, secret) => out.split(secret).join('***'), text);

  /** One process; returns { status, stdout, stderr } with any token redacted from the output. */
  function run(command, args, input) {
    const result = spawn(command, args, {
      cwd,
      env,
      encoding: 'utf8',
      input,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error?.code === 'ENOENT') throw new Error(`${command} is not installed`);
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: redact(`${result.stderr ?? ''}`),
    };
  }

  /** `gh api`; `tolerate(result)` may accept a failure (returns true). */
  function api(method, path, { body, paged = false, tolerate } = {}) {
    const args = ['api', '--method', method, path, ...(paged ? PAGED : [])];
    if (body !== undefined) args.push('--input', '-');
    const result = run('gh', args, body === undefined ? undefined : JSON.stringify(body));
    if (result.status !== 0) {
      if (tolerate?.(result)) return null;
      throw new Error(
        `gh api ${method} ${path} failed (exit ${result.status}): ${result.stderr.trim() || redact(result.stdout).trim()}`
      );
    }
    if (paged)
      return result.stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  }

  const issues = `repos/${repo}/issues`;
  return {
    /**
     * The runner's own login, asked once (REQ-ISS-024): only comments by it are state. The job
     * token cannot read `GET /user` (HTTP 403), and its comments are by the Actions bot.
     */
    whoami: () => {
      login ??=
        api('GET', 'user', { tolerate: (r) => /HTTP 403/.test(r.stderr) })?.login ?? ACTIONS_BOT;
      return login;
    },
    getIssue: (n) => normalizeIssue(api('GET', `${issues}/${positive(n, 'issue number')}`)),
    listComments: (n) =>
      api('GET', `${issues}/${positive(n, 'issue number')}/comments?per_page=100`, {
        paged: true,
      }).map(normalizeComment),
    createComment: (n, body) => {
      const comment = api('POST', `${issues}/${positive(n, 'issue number')}/comments`, {
        body: { body },
      });
      return { id: comment.id, url: comment.html_url };
    },
    updateComment: (id, body) => {
      const comment = api('PATCH', `${issues}/comments/${positive(id, 'comment id')}`, {
        body: { body },
      });
      return { id: comment.id, url: comment.html_url };
    },
    getLabels: (n) =>
      api('GET', `${issues}/${positive(n, 'issue number')}/labels?per_page=100`, {
        paged: true,
      }).map((label) => label.name),
    /** Replaces every label on the issue: callers keep the labels they do not own (REQ-ISS-002). */
    setLabels: (n, names) =>
      api('PUT', `${issues}/${positive(n, 'issue number')}/labels`, {
        body: { labels: names },
      }).map((label) => label.name),
    /** One create per name; "already exists" (HTTP 422) counts as done. Returns the names created. */
    ensureLabels: (names) =>
      names.filter(
        (name) =>
          api('POST', `repos/${repo}/labels`, {
            body: { name },
            tolerate: (r) => /HTTP 422/.test(r.stderr) || /already_exists/.test(r.stdout),
          }) !== null
      ),
    /** The collaborator's role (REQ-ISS-004), never the payload's `author_association`. */
    permission: (login) => {
      if (!LOGIN.test(login ?? '')) throw new Error(`not a valid login: ${login}`);
      const result = api('GET', `repos/${repo}/collaborators/${login}/permission`, {
        tolerate: (r) => /HTTP 404/.test(r.stderr),
      });
      const role = result?.role_name ?? result?.permission;
      return PERMISSIONS.includes(role) ? role : 'none';
    },
    listOpenPrs: () =>
      api('GET', `repos/${repo}/pulls?state=open&per_page=100`, { paged: true }).map(normalizePr),
    createPr: ({ head, base, title, body, draft = true }) =>
      link(api('POST', `repos/${repo}/pulls`, { body: { head, base, title, body, draft } })),
    updatePr: (number, fields) =>
      link(
        api('PATCH', `repos/${repo}/pulls/${positive(number, 'pull request number')}`, {
          body: fields,
        })
      ),
    /** Not an API call: the branch's commits go up with git, using the checkout's credentials. */
    pushBranch: (branch) => {
      if (!BRANCH.test(branch ?? '')) throw new Error(`not a valid branch name: ${branch}`);
      const result = run('git', ['push', '-u', 'origin', branch]);
      if (result.status !== 0)
        throw new Error(
          `git push of ${branch} failed (exit ${result.status}): ${result.stderr.trim()}`
        );
    },
  };
}

/**
 * The same surface over in-memory state. `calls` records `{ method, args }` in order; `state` is
 * the live data a test asserts on. Return values are copies, so callers cannot edit the state.
 */
export function fakeGitHub({
  login = 'runner',
  issue = {},
  comments = [],
  labels,
  permissions = {},
  prs = [],
  repoLabels = [],
} = {}) {
  const copy = (value) => structuredClone(value);
  const state = {
    issue: {
      number: 1,
      title: '',
      body: '',
      author: { login: 'author', type: 'User' },
      state: 'open',
      isPullRequest: false,
      ...issue,
    },
    comments: comments.map(normalizeComment),
    labels: [...(labels ?? issue.labels ?? [])],
    repoLabels: [...repoLabels],
    prs: prs.map((pr) => ({ ...pr })),
    pushed: [],
  };
  let nextId = 1000;
  const calls = [];
  const record =
    (method, fn) =>
    (...args) => {
      calls.push({ method, args: copy(args) });
      return copy(fn(...args));
    };
  const comment = (id) => {
    const found = state.comments.find((c) => c.id === id);
    if (!found) throw new Error(`no comment ${id}`);
    return found;
  };
  return {
    calls,
    state,
    whoami: record('whoami', () => login),
    getIssue: record('getIssue', () => ({ ...state.issue, labels: state.labels })),
    listComments: record('listComments', () => state.comments),
    createComment: record('createComment', (n, body) => {
      const id = nextId++;
      const url = `https://github.com/o/r/issues/${n}#issuecomment-${id}`;
      state.comments.push({
        id,
        body,
        author: { login, type: 'Bot' },
        createdAt: null,
        url,
      });
      return { id, url };
    }),
    updateComment: record('updateComment', (id, body) => {
      const found = comment(id);
      found.body = body;
      return { id, url: found.url };
    }),
    getLabels: record('getLabels', () => state.labels),
    setLabels: record('setLabels', (n, names) => (state.labels = [...names])),
    ensureLabels: record('ensureLabels', (names) => {
      const created = names.filter((name) => !state.repoLabels.includes(name));
      state.repoLabels.push(...created);
      return created;
    }),
    permission: record('permission', (login) => permissions[login] ?? 'none'),
    listOpenPrs: record('listOpenPrs', () => state.prs),
    createPr: record('createPr', ({ head, base, title, body, draft = true }) => {
      const number = 100 + state.prs.length;
      const url = `https://github.com/o/r/pull/${number}`;
      state.prs.push({ number, url, title, body, draft, base, headRefName: head, headRepo: 'o/r' });
      return { number, url };
    }),
    updatePr: record('updatePr', (number, fields) => {
      const pr = state.prs.find((p) => p.number === number);
      if (!pr) throw new Error(`no pull request ${number}`);
      Object.assign(pr, fields);
      return { number, url: pr.url };
    }),
    pushBranch: record('pushBranch', (branch) => {
      state.pushed.push(branch);
    }),
  };
}
