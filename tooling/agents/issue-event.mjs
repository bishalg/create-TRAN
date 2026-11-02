/**
 * GitHub issue events (spec 020, ADR-0037): the payload as a small normalized object, the command a
 * comment carries, the runner's own comment marker, and the issue rendered as untrusted evidence.
 * Pure functions: no GitHub access here (that is github.mjs), no file access but the signal's read.
 */
import { existsSync, readFileSync } from 'node:fs';

/** The `on:` values an issue task may list (REQ-ISS-001). */
export const ISSUE_EVENTS = ['opened', 'edited', 'labeled', 'commented'];
/** Commands, each the first word of a comment's first non-blank line (REQ-ISS-004). */
export const COMMANDS = ['plan', 'approve', 'implement', 'review', 'screenshots'];

/** Label names by role (REQ-ISS-002): the five triage labels, then the two status labels. */
export const DEFAULT_LABELS = {
  'needs-detail': 'needs-detail',
  'approval-needed': 'approval-needed',
  'human-decision-needed': 'human-decision-needed',
  'review-needed': 'review-needed',
  'good-to-merge': 'good-to-merge',
  running: 'agent:running',
  failed: 'agent:failed',
};

/** `issues` settings in `.agents/policy.json`; the policy states these values too. */
export const ISSUE_DEFAULTS = {
  applyRewrite: false,
  autonomy: { simple: 'plan-approve' },
  modelFor: 'collaborators',
  requireTests: true,
  complexWhen: {
    maxPaths: 5,
    keywords: ['migration', 'auth', 'payment', 'package.json', 'Cargo.toml', 'dependency'],
  },
  uiGlobs: [],
  screenshotCommand: '',
  ciFix: { enabled: false, workflows: ['CI'], maxAttempts: 1 },
};

/** Drops `$comment` and other `$` keys, which document the policy file. */
const settings = (object = {}) =>
  Object.fromEntries(Object.entries(object).filter(([key]) => !key.startsWith('$')));

export const labelNames = (policy = {}) => ({ ...DEFAULT_LABELS, ...settings(policy.labels) });
export const ownedLabels = (policy = {}) => Object.values(labelNames(policy));

/** The policy's `issues` over the defaults, one level of nested objects merged. */
export function issueSettings(policy = {}) {
  const own = settings(policy.issues);
  const merged = { ...ISSUE_DEFAULTS, ...own };
  for (const [key, value] of Object.entries(ISSUE_DEFAULTS))
    if (value && typeof value === 'object' && !Array.isArray(value))
      merged[key] = { ...value, ...own[key] };
  return merged;
}

// ── Marker (REQ-ISS-020) ────────────────────────────────────────────────────────────────────────

const MARKER = /^\s*<!-- tran-agent (\{.*?\}) -->/;

/** The first line of every runner comment: `<!-- tran-agent {"stage":…} -->`. */
export function renderMarker(data) {
  const json = JSON.stringify(data);
  if (json.includes('-->')) throw new Error('a marker cannot hold "-->": it would end the comment');
  return `<!-- tran-agent ${json} -->`;
}

/** The marker's data when the comment starts with one, else null. */
export function parseMarker(body) {
  const match = MARKER.exec(body ?? '');
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ── Events (REQ-ISS-001) ────────────────────────────────────────────────────────────────────────

/** `/approve rest…` on the first non-blank line → { command, commandText: rest and later lines }. */
export function parseCommand(body) {
  const text = (body ?? '').replace(/\r\n/g, '\n').trimStart();
  const match = new RegExp(`^/(${COMMANDS.join('|')})(?=\\s|$)[ \\t]*`).exec(text);
  if (!match) return { command: null, commandText: null };
  return { command: match[1], commandText: text.slice(match[0].length).trim() };
}

const person = (user) => ({ login: user?.login ?? 'ghost', type: user?.type ?? 'User' });

/** A GitHub API comment (or one already normalized) → { id, body, author, createdAt, url }. */
export const normalizeComment = (c) => ({
  id: c.id,
  body: c.body ?? '',
  author: c.author ?? person(c.user),
  createdAt: c.createdAt ?? c.created_at ?? null,
  url: c.url ?? c.html_url ?? null,
});

const KINDS = { opened: 'opened', edited: 'edited', labeled: 'labeled' };

/**
 * An `issues` or `issue_comment` payload → the fields the runner decides on. `kind` is null for an
 * action it does not handle (closed, a comment edited or deleted). `author_association` is left out
 * on purpose: command permissions come from the API (REQ-ISS-004).
 */
export function parseIssueEvent(payload) {
  const issue = payload?.issue;
  if (!issue || typeof issue.number !== 'number')
    throw new Error('not an issue event: the payload has no "issue"');
  const comment = payload.comment ? normalizeComment(payload.comment) : null;
  const kind = comment
    ? payload.action === 'created'
      ? 'commented'
      : null
    : (KINDS[payload.action] ?? null);
  const { command, commandText } = kind === 'commented' ? parseCommand(comment.body) : {};
  return {
    kind,
    action: payload.action ?? null,
    number: issue.number,
    title: issue.title ?? '',
    body: issue.body ?? '',
    labels: (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)),
    author: person(issue.user),
    sender: person(payload.sender),
    repo: payload.repository?.full_name ?? null,
    isPullRequest: Boolean(issue.pull_request),
    label: kind === 'labeled' ? (payload.label?.name ?? null) : null,
    comment,
    command: command ?? null,
    commandText: commandText ?? null,
  };
}

/** Why this event is nothing for the runner to do (REQ-ISS-019), or null when it is work. */
export function skipReason(event, policy) {
  if (event.sender.type === 'Bot') return `sender ${event.sender.login} is a bot`;
  if (!event.kind) return `"${event.action}" is not an event issue tasks handle`;
  if (event.kind === 'commented') {
    if (parseMarker(event.comment.body))
      return "the runner's own comment (it starts with the marker)";
    if (!event.command) return 'the comment has no command on its first line';
  }
  if (event.kind === 'labeled' && ownedLabels(policy).includes(event.label))
    return `label "${event.label}" is the runner's own`;
  return null;
}

// ── Evidence (REQ-ISS-011) ──────────────────────────────────────────────────────────────────────

function describeEvent(event) {
  const by = `by @${event.sender.login}`;
  if (event.kind === 'commented')
    return `commented ${by}${event.command ? ` (command: /${event.command})` : ''}`;
  if (event.kind === 'labeled') return `labeled "${event.label}" ${by}`;
  return `${event.kind ?? event.action} ${by}`;
}

/**
 * The issue as plain text for the agent; `buildPrompt` fences it as untrusted. `comments` are API
 * or normalized comments, oldest first; the triggering comment is added when missing. Over
 * `maxLines`, the oldest comments go first, so the issue and the newest comments stay.
 */
export function renderIssueEvidence(event, comments = [], { maxLines = Infinity } = {}) {
  const all = comments.map(normalizeComment);
  if (event.comment && !all.some((c) => c.id === event.comment.id)) all.push(event.comment);
  const head = [
    `Issue #${event.number} in ${event.repo ?? 'this repository'}: ${event.title}`,
    `Author: @${event.author.login} · Labels: ${event.labels.length ? event.labels.join(', ') : 'none'}`,
    `Event: ${describeEvent(event)}`,
    '',
    '--- Issue body ---',
    event.body.trim() || '(empty)',
  ];
  const blocks = all.map((c, i) => [
    '',
    `--- Comment ${i + 1} by @${c.author.login} (id ${c.id}) ---`,
    c.body.trim() || '(empty)',
  ]);
  const render = (dropped) =>
    [
      ...head,
      ...(dropped ? ['', `(${dropped} older comments omitted)`] : []),
      ...blocks.slice(dropped).flat(),
    ].join('\n');
  let dropped = 0;
  while (dropped < blocks.length && render(dropped).split('\n').length > maxLines) dropped++;
  return render(dropped);
}

// ── Signal (REQ-ISS-019) ────────────────────────────────────────────────────────────────────────

/**
 * The `issue-event` signal over a payload: exit 0 when there is nothing to do, 127 when the payload
 * is not an issue event, else exit 1 with the issue as evidence, marked untrusted.
 */
export function issueEventSignal(payload, policy, { comments = [], maxLines } = {}) {
  let event;
  try {
    event = parseIssueEvent(payload);
  } catch (error) {
    return { status: 127, output: error.message };
  }
  const reason = skipReason(event, policy);
  if (reason) return { status: 0, output: `nothing to do: ${reason}` };
  return {
    status: 1,
    output: renderIssueEvidence(event, comments, { maxLines }),
    untrusted: true,
  };
}

/** The payload at `AGENT_EVENT` (set by `--event`), else `GITHUB_EVENT_PATH`. */
export function readEventSignal(policy, env = process.env) {
  const path = env.AGENT_EVENT || env.GITHUB_EVENT_PATH;
  if (!path || !existsSync(path))
    return {
      status: 127,
      output: `no event payload: pass --event <path> or set GITHUB_EVENT_PATH (got "${path ?? ''}")`,
    };
  let payload;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { status: 127, output: `${path} is not JSON: ${error.message}` };
  }
  return issueEventSignal(payload, policy);
}
