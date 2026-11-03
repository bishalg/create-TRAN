/**
 * Commands, plans and the implementation's shape (spec 020, ADR-0037 D3, D6): who may command,
 * which comment is the approved plan, the branch an issue gets, what the implementation prompt adds,
 * the pull request body, and the diff check that a code change came with a test.
 * Pure functions: the orchestrator (issue.mjs) does the GitHub and git work.
 */
import { createHash } from 'node:crypto';
import { fenceFor } from './harness.mjs';
import { issueSettings, parseIssueEvent, parseMarker, skipReason } from './issue-event.mjs';

/** Roles that may command the runner (REQ-ISS-004); `triage` and `read` may not. */
export const WRITE_ACCESS = ['admin', 'maintain', 'write'];
/** The sections a plan names (REQ-ISS-008); the `issue-gate` task writes them after `PLAN:`. */
export const PLAN_SECTIONS = [
  'Goal',
  'Files',
  'Requirement ids',
  'Tests to write first',
  'Risks',
  'Estimated lines',
];
/** Commands that start an implementation, so the job needs the build toolchain for the gates. */
export const BUILD_COMMANDS = ['approve', 'implement'];

export const canCommand = (role) => WRITE_ACCESS.includes(role);

// ── Branch (REQ-ISS-009) ────────────────────────────────────────────────────────────────────────

/** Every branch of issue `n` starts with this; pull requests are deduplicated by it (ADR-0037 D6). */
export const issuePrefix = (prefix, number) => `${prefix}issue-${number}-`;

/**
 * `agent/issue-12-add-country-lookup`: lowercase ASCII, dashes, at most 40 characters of slug. The
 * number comes first, so the branch always resolves to the task `issue`, never `issue-gate`.
 */
export function issueBranch(prefix, number, title) {
  const slug =
    String(title ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'change';
  return `${issuePrefix(prefix, number)}${slug}`;
}

// ── Plans (REQ-ISS-008, REQ-ISS-021) ────────────────────────────────────────────────────────────

/**
 * The text under the first `## Plan` (or `### Plan`) heading, up to the next heading of the same
 * or a higher level; headings inside code fences are text. Null when there is none or it is empty.
 */
export function planSection(body) {
  let fence = null;
  let level = 0;
  const out = [];
  for (const line of (body ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    const inFence = fence !== null;
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length)))
      fence = fence ? null : marker;
    const heading = inFence || marker ? null : /^\s{0,3}(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!level) {
      if (heading && /^plan:?$/i.test(heading[2])) level = heading[1].length;
      continue;
    }
    if (heading && heading[1].length <= level) break;
    out.push(line);
  }
  const text = out.join('\n').trim();
  return level && text ? text : null;
}

export const planHash = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

/**
 * The plan an approval carries (REQ-ISS-021): the newest comment at or before `approvalId` that is
 * either the runner's own `plan` comment or holds a `## Plan` section and is by a write-access user.
 * `permissionOf(login)` returns the role; `runner` is the runner's login, so a marker in anyone
 * else's comment is not the runner's plan (REQ-ISS-024). Returns { text, comment } or null.
 */
export function selectPlan(comments, approvalId, permissionOf, runner) {
  const at = comments.findIndex((c) => c.id === approvalId);
  const candidates = (at === -1 ? comments : comments.slice(0, at + 1)).toReversed();
  for (const comment of candidates) {
    const text = planSection(comment.body);
    if (!text) continue;
    const login = comment.author?.login;
    if (login === runner) {
      if (parseMarker(comment.body)?.stage === 'plan') return { text, comment };
    } else if (canCommand(permissionOf(login))) return { text, comment };
  }
  return null;
}

const fakeNote = (harness) =>
  harness === 'fake' ? ' (fake harness: canned output, no model ran)' : '';

/**
 * The runner's one `plan` comment (without its marker). `approval`: { by, url, hash, source } once
 * approved; `result`: what the implementation did, in words.
 */
export function renderPlanComment({ plan, harness, approval, result }) {
  const missing = PLAN_SECTIONS.filter(
    (name) => !new RegExp(`(^|\\n)\\s*(?:[-*]\\s+)?(?:\\*\\*)?${name}\\b`, 'i').test(plan)
  );
  const lines = ['## Plan', '', plan.trim(), '', '## Approval', ''];
  if (approval)
    lines.push(
      `Approved by @${approval.by}${approval.url ? ` in ${approval.url}` : ''} · plan \`${approval.hash}\` · from ${approval.source}.`
    );
  else
    lines.push(
      'A maintainer comments `/approve` to implement this plan. To change it first, comment a `## Plan` section of',
      'your own: the newest plan at or before `/approve` is the one implemented.'
    );
  if (missing.length) lines.push('', `The plan does not name: ${missing.join(', ')}.`);
  if (result) lines.push('', '## Result', '', result);
  lines.push('', `_Runner · harness: ${harness}${fakeNote(harness)}_`);
  return lines.join('\n');
}

// ── The implementation prompt (REQ-ISS-010, REQ-ISS-021) ────────────────────────────────────────

export const APPROVED =
  'A person with write access approved this plan for the issue in the evidence. Implement this plan, within the limits above; where the issue and the plan disagree, follow the plan.';

/**
 * What the runner adds after the prompt: the approved plan in its own fence, and spec-first.
 * `note` replaces the approval sentence when no person approved (`autonomy.simple: auto`).
 */
export function implementationExtras({ plan, specFirst, requireTests = true, note = APPROVED }) {
  const fence = fenceFor(plan);
  const lines = ['## Approved plan', '', note, '', `${fence}text`, plan.trim(), fence];
  if (specFirst)
    lines.push(
      '',
      '## Spec first',
      '',
      'This repository is spec-first: add or update the requirement in `docs/specs/`, then write the failing test citing it before code, then the code.',
      ...(requireTests
        ? [
            'A change to a code file without a change to a test file is not kept (`issues.requireTests`).',
          ]
        : [])
    );
  return lines.join('\n');
}

// ── The diff check (REQ-ISS-010) ────────────────────────────────────────────────────────────────

const CODE = /\.(?:ts|tsx|js|mjs|rs|swift|kt|kts)$/;
const TEST =
  /(?:^|\/)(?:tests?|Tests|__tests__|e2e)\/|\.(?:test|spec|steps)\.[^/]+$|Tests?\.(?:swift|kt)$|_test\.[^/]+$/;

/**
 * One problem when the change touches a code file and no test file (`issues.requireTests`), else
 * none. Documentation, specs, fixtures and other data never need a test.
 */
export function missingTests(changes) {
  const code = changes.map((c) => c.path).filter((path) => CODE.test(path) && !TEST.test(path));
  if (!code.length || changes.some((c) => TEST.test(c.path))) return [];
  return [
    `a code change without a test change: ${code.join(', ')} (issues.requireTests, REQ-ISS-010); add or update the test that covers it`,
  ];
}

// ── The pull request body (REQ-ISS-009) ─────────────────────────────────────────────────────────

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The hand-off in the pull request template's `##` sections: a section in the hand-off may be a
 * heading or a bold lead (`**What**`, as the prompt asks). Without a template, or when the hand-off
 * has none of its sections, the hand-off is kept as written.
 */
export function fitTemplate(body, template) {
  const names = template ? [...template.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]) : [];
  if (!names.length) return body;
  const patterns = names.map((name) => [
    name,
    new RegExp(
      `^\\s{0,3}(?:#{1,4}\\s+${escape(name)}:?\\s*$|\\*\\*${escape(name)}:?\\*\\*:?\\s*(.*)$)`,
      'i'
    ),
  ]);
  const sections = {};
  const preamble = [];
  let current = null;
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const hit = patterns.find(([, pattern]) => pattern.test(line));
    if (hit) {
      current = hit[0];
      sections[current] = [hit[1].exec(line)[1] ?? ''];
    } else (current ? sections[current] : preamble).push(line);
  }
  if (!current) return body;
  const out = preamble.join('\n').trim() ? [preamble.join('\n').trim(), ''] : [];
  for (const name of names)
    out.push(
      `## ${name}`,
      '',
      (sections[name] ?? []).join('\n').trim() || '_Not given by the agent._',
      ''
    );
  return out.join('\n').trim();
}

// ── The workflow's question (REQ-ISS-009) ───────────────────────────────────────────────────────

/**
 * Whether this event may start an implementation, so the job installs the build toolchain that the
 * `issue` task's gates need: `/approve` or `/implement`, or a gate under `autonomy.simple: auto`.
 * Permission is checked later; installing for an ignored command only costs time.
 */
export function needsToolchain(payload, policy) {
  let event;
  try {
    event = parseIssueEvent(payload);
  } catch {
    return false;
  }
  if (skipReason(event, policy) || event.isPullRequest) return false;
  if (event.kind === 'commented') return BUILD_COMMANDS.includes(event.command);
  if (event.kind === 'opened' || event.kind === 'edited')
    return issueSettings(policy).autonomy.simple === 'auto';
  return false;
}
