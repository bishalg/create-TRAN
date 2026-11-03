/**
 * The issue quality gate (spec 020, ADR-0037 D2): the story template's sections, the structural
 * verdict the runner reaches without a model, the judgment report's `VERDICT:`/`SIZE:` lines, the
 * rewrite skeleton, the size class, the gate comment, and the label and marker state on GitHub.
 * Pure functions, except the last block, which goes through the injected GitHub client only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fenceFor } from './harness.mjs';
import { labelNames, parseMarker, renderMarker } from './issue-event.mjs';

/** The story template's sections when a repository has none (REQ-ISS-005). */
export const DEFAULT_SECTIONS = [
  'Story',
  'Requirement ids',
  'Acceptance criteria',
  'Out of scope',
  'Definition of done',
];
export const TEMPLATE_DIR = '.github/ISSUE_TEMPLATE';
/** The triage labels, by role: exactly one is on an issue at a time (REQ-ISS-002). */
export const TRIAGE = [
  'needs-detail',
  'approval-needed',
  'human-decision-needed',
  'review-needed',
  'good-to-merge',
];
export const STATUS = ['running', 'failed'];
export const VERDICTS = ['ready', 'needs-detail', 'human-decision-needed'];
export const NO_VERDICT = 'the model returned no verdict';

// ── Template (REQ-ISS-005) ──────────────────────────────────────────────────────────────────────

/** `.github/ISSUE_TEMPLATE/story.md`, else the first Markdown template, else null. */
export function readTemplate(root) {
  const dir = join(root, TEMPLATE_DIR);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort();
  const file = files.includes('story.md') ? 'story.md' : files[0];
  return file ? readFileSync(join(dir, file), 'utf8') : null;
}

const withoutFrontmatter = (text) =>
  text.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
export const stripHtmlComments = (text) => (text ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
const norm = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The body's `##`/`###` headings (issue forms render `###`) with the text under each; headings
 * inside code fences are text. `preamble` is the text before the first heading.
 */
export function splitSections(body) {
  const sections = [];
  const preamble = [];
  let fence = null;
  for (const line of (body ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length)))
      fence = fence ? null : marker;
    const heading = fence || marker ? null : /^\s{0,3}#{2,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) sections.push({ heading: heading[1], lines: [] });
    else (sections.at(-1)?.lines ?? preamble).push(line);
  }
  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map((s) => ({ heading: s.heading, text: s.lines.join('\n').trim() })),
  };
}

/** The template's section headings, in order; the five defaults without a template. */
export function templateSections(text) {
  if (text === null || text === undefined) return [...DEFAULT_SECTIONS];
  return splitSections(withoutFrontmatter(text)).sections.map((s) => s.heading.replace(/:$/, ''));
}

/** Each section's hint: the HTML comment the template puts under its heading. */
export function templateHints(text) {
  if (text === null || text === undefined) return {};
  return Object.fromEntries(
    splitSections(withoutFrontmatter(text))
      .sections.map((s) => [s.heading.replace(/:$/, ''), /<!--[\s\S]*?-->/.exec(s.text)?.[0]])
      .filter(([, hint]) => hint)
  );
}

// ── Structural tier (REQ-ISS-005) ───────────────────────────────────────────────────────────────

const REQ_ID = /\bREQ-[A-Z0-9]+-\d{3}\b/;
const GIVEN_WHEN_THEN = /\bgiven\b.*\bwhen\b.*\bthen\b/i;
const IDS_SECTION = /requirement/i;
const CRITERIA_SECTION = /acceptance|criteria/i;

/** The text under each template section (null when the body lacks it), HTML comments removed. */
function sectionTexts(body, sections) {
  const { sections: found } = splitSections(stripHtmlComments(body));
  return sections.map((name) => {
    const matches = found.filter((s) => norm(s.heading) === norm(name));
    return {
      name,
      text: matches.length
        ? matches
            .map((s) => s.text)
            .join('\n')
            .trim()
        : null,
    };
  });
}

/**
 * Without a model: one reason per section that is missing or empty, and for the ids and criteria
 * sections one reason when they hold no `REQ-` id or no Given/When/Then line (REQ-ISS-005).
 */
export function structuralVerdict(body, sections = DEFAULT_SECTIONS) {
  const texts = sectionTexts(body, sections);
  const reasons = texts.flatMap(({ name, text }) => {
    if (IDS_SECTION.test(name)) return REQ_ID.test(text ?? '') ? [] : [`${name}: no REQ- id`];
    if (CRITERIA_SECTION.test(name))
      return (text ?? '').split('\n').some((line) => GIVEN_WHEN_THEN.test(line))
        ? []
        : [`${name}: no Given/When/Then line`];
    if (text === null) return [`${name}: missing`];
    return text ? [] : [`${name}: empty`];
  });
  // A template without those sections still needs both somewhere in the issue.
  const plain = stripHtmlComments(body);
  if (!sections.some((s) => IDS_SECTION.test(s)) && !REQ_ID.test(plain))
    reasons.push('Requirement ids: no REQ- id');
  if (
    !sections.some((s) => CRITERIA_SECTION.test(s)) &&
    !plain.split('\n').some((line) => GIVEN_WHEN_THEN.test(line))
  )
    reasons.push('Acceptance criteria: no Given/When/Then line');
  return { verdict: reasons.length ? 'needs-detail' : 'ready', reasons };
}

// ── Judgment tier (REQ-ISS-005) ─────────────────────────────────────────────────────────────────

/** A block that starts on a line `NAME:` and runs to the next block or the end. */
function block(lines, name) {
  const start = lines.findIndex((line) => line.trim() === `${name}:`);
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && /^(REWRITE|PLAN):\s*$/.test(line.trim()));
  const text = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  return text || null;
}

/**
 * The read-only gate task's report: `VERDICT: <value>` on its first non-blank line, optional
 * `SIZE:` line, `- reason` bullets before any block, and optional `REWRITE:` and `PLAN:` blocks.
 */
export function parseJudgment(report) {
  const lines = (report ?? '').replace(/\r\n/g, '\n').split('\n');
  const first = lines.find((line) => line.trim()) ?? '';
  const verdict = /^VERDICT:\s*([a-z-]+)\s*$/i.exec(first.trim())?.[1].toLowerCase();
  const stop = lines.findIndex((line) => /^(REWRITE|PLAN):\s*$/.test(line.trim()));
  const head = stop === -1 ? lines : lines.slice(0, stop);
  const size = head
    .map((line) => /^SIZE:\s*(simple|complex)\s*$/i.exec(line.trim())?.[1].toLowerCase())
    .find(Boolean);
  return {
    verdict: VERDICTS.includes(verdict) ? verdict : null,
    size: size ?? null,
    reasons: head.map((line) => /^\s*[-*]\s+(.+)$/.exec(line)?.[1].trim()).filter(Boolean),
    rewrite: block(lines, 'REWRITE'),
    plan: block(lines, 'PLAN'),
  };
}

/**
 * The gate's verdict. A structural `needs-detail` stands whatever the model says; a skipped
 * judgment (`report` null) leaves the structural verdict; a report without a valid first-line
 * verdict is `human-decision-needed`, never `ready` (REQ-ISS-005).
 */
export function mergeVerdicts(structural, report) {
  const none = { tier: 'structural', modelSize: null, rewrite: null };
  if (structural.verdict !== 'ready' || report === null || report === undefined)
    return { verdict: structural.verdict, reasons: structural.reasons, ...none };
  const judged = parseJudgment(report);
  if (!judged.verdict)
    return { verdict: 'human-decision-needed', reasons: [NO_VERDICT], ...none, tier: 'judgment' };
  return {
    verdict: judged.verdict,
    reasons: judged.reasons,
    tier: 'judgment',
    modelSize: judged.size,
    rewrite: judged.verdict === 'needs-detail' ? judged.rewrite : null,
  };
}

// ── Rewrite (REQ-ISS-006) ───────────────────────────────────────────────────────────────────────

/**
 * The template with the author's text slotted in: text under a heading that matches a section
 * goes there, anything else (the text before any heading, unknown headings) goes under the story
 * section. Each empty section gets the template's hint, or a generic one.
 */
export function rewriteSkeleton(issue, sections = DEFAULT_SECTIONS, hints = {}) {
  const { preamble, sections: found } = splitSections(stripHtmlComments(issue.body));
  const storyAt = Math.max(
    0,
    sections.findIndex((name) => /story/i.test(name))
  );
  const slots = sections.map(() => []);
  if (preamble) slots[storyAt].push(preamble);
  for (const { heading, text } of found) {
    const at = sections.findIndex((name) => norm(name) === norm(heading));
    if (at !== -1) {
      if (text) slots[at].push(text);
    } else slots[storyAt].push(text ? `**${heading}**\n\n${text}` : `**${heading}**`);
  }
  return sections
    .map((name, i) => {
      const text = slots[i].join('\n\n') || hints[name] || `<!-- ${name}: still to write. -->`;
      return `## ${name}\n\n${text}`;
    })
    .join('\n\n');
}

// ── Size (REQ-ISS-007) ──────────────────────────────────────────────────────────────────────────

const PATH = /(?<![\w./:-])(?:[\w.-]+\/)+[\w.-]*[\w-]|(?<![\w./:-])[\w-]+\.(?:[a-z]{1,5})\b/g;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** File paths the issue names, URLs left out, each counted once. */
export function namedPaths(text) {
  const plain = stripHtmlComments(text).replace(/\bhttps?:\/\/\S+/g, ' ');
  return [...new Set(plain.match(PATH) ?? [])].filter((path) => !/^\d+(\.\d+)*$/.test(path));
}

/**
 * `simple` or `complex` with every reason (REQ-ISS-007): more than `maxPaths` paths, a policy
 * keyword (whole word, plural allowed), or an estimate over the line budget. The model's `SIZE:`
 * may raise the class, never lower it.
 */
export function sizeClass(issue, complexWhen = {}, budget = Infinity, modelSize = null) {
  const text = `${issue.title ?? ''}\n${stripHtmlComments(issue.body)}`;
  const { maxPaths = 5, keywords = [] } = complexWhen;
  const reasons = [];
  const paths = namedPaths(text).length;
  if (paths > maxPaths) reasons.push(`names ${plural(paths, 'file path')} (more than ${maxPaths})`);
  for (const keyword of keywords)
    if (new RegExp(`(?<![\\w-])${escape(keyword)}(?:e?s)?(?![\\w-])`, 'i').test(text))
      reasons.push(`mentions "${keyword}"`);
  const estimate = /\bestimated(?: changed)? lines?:?\s*(\d+)/i.exec(text);
  if (estimate && Number(estimate[1]) > budget)
    reasons.push(`estimates ${estimate[1]} changed lines (budget ${budget})`);
  if (reasons.length) return { size: 'complex', reasons };
  if (modelSize === 'complex')
    return { size: 'complex', reasons: ['the judgment tier said SIZE: complex'] };
  return {
    size: 'simple',
    reasons: [
      `names ${plural(paths, 'file path')} (at most ${maxPaths})`,
      'no keyword from issues.complexWhen',
    ],
  };
}

// ── The gate comment (REQ-ISS-005, -006, -007, -018) ────────────────────────────────────────────

/**
 * The runner's one `gate` comment (without its marker). `judgment`: what happened to the model
 * tier, in words (`ran`, `skipped: no harness credential`, …); `next`: what a person does now.
 */
export function renderGateComment({
  verdict,
  reasons = [],
  rewrite,
  size,
  sizeReasons = [],
  judgment,
  harness,
  next,
}) {
  const fake = harness === 'fake';
  const lines = [`**Issue check: ${verdict}**`, ''];
  if (reasons.length) lines.push('Reasons:', '', ...reasons.map((r) => `- ${r}`), '');
  if (size) lines.push(`Size: **${size}**`, '', ...sizeReasons.map((r) => `- ${r}`), '');
  if (rewrite) {
    const fence = fenceFor(rewrite);
    lines.push(
      '### Suggested issue body',
      '',
      'Your text is placed under the section it belongs to; fill in the sections that only hold a hint.',
      '',
      `${fence}markdown`,
      rewrite,
      fence,
      ''
    );
  }
  if (verdict === 'needs-detail')
    lines.push('Edit the issue to run this check again; the label clears when it passes.', '');
  if (next) lines.push(next, '');
  lines.push(
    `_Structural check by the runner · judgment: ${judgment} · harness: ${harness}${
      fake ? ' (fake harness: canned output, no model ran, not a review)' : ''
    }_`
  );
  return lines.join('\n');
}

// ── Labels and markers on GitHub (REQ-ISS-002, REQ-ISS-020) ─────────────────────────────────────

const triageNames = (policy) => TRIAGE.map((role) => labelNames(policy)[role]);

/**
 * Leaves exactly one triage label, `role`, keeping every label the runner does not own and the
 * status labels; creates the runner's labels first (REQ-ISS-002). Returns the labels now set.
 */
export function applyTriageLabel(gh, number, role, policy) {
  if (!TRIAGE.includes(role))
    throw new Error(`"${role}" is not a triage label (${TRIAGE.join(', ')})`);
  const names = labelNames(policy);
  gh.ensureLabels([...TRIAGE, ...STATUS].map((r) => names[r]));
  const current = gh.getLabels(number);
  const triage = triageNames(policy);
  const next = [...current.filter((label) => !triage.includes(label)), names[role]];
  if (next.length === current.length && next.every((label) => current.includes(label)))
    return current;
  return gh.setLabels(number, next);
}

/** Adds or removes one status label (`running`, `failed`); no write when nothing changes. */
export function setStatusLabel(gh, number, status, on, policy) {
  if (!STATUS.includes(status)) throw new Error(`"${status}" is not a status label`);
  const name = labelNames(policy)[status];
  const current = gh.getLabels(number);
  if (current.includes(name) === on) return current;
  if (on) gh.ensureLabels([name]);
  return gh.setLabels(number, on ? [...current, name] : current.filter((l) => l !== name));
}

/**
 * The comments the runner wrote itself (REQ-ISS-024): anyone can type a marker, so only comments by
 * the runner's own login (`gh.whoami()`) are state, and only those are ever edited.
 */
export const byRunner = (comments, runner) => comments.filter((c) => c.author?.login === runner);

/** The runner's comment for `stage`, the newest when there are several, or null. */
const stageComment = (comments, stage, runner) =>
  byRunner(comments, runner)
    .filter((c) => parseMarker(c.body)?.stage === stage)
    .at(-1) ?? null;

/**
 * One comment per stage per issue, updated in place: `<marker>\n<body>` (REQ-ISS-020). `comments`
 * saves a listing when the caller has them; `runner` the identity lookup. Returns
 * { id, url, created }.
 */
export function upsertStageComment(gh, number, stage, body, data = {}, comments, runner) {
  const text = `${renderMarker({ stage, ...data })}\n${body}`;
  const own = runner ?? gh.whoami();
  const existing = stageComment(comments ?? gh.listComments(number), stage, own);
  if (existing) return { ...gh.updateComment(existing.id, text), created: false };
  return { ...gh.createComment(number, text), created: true };
}

/**
 * Everything the next stage decides on, from labels and markers only (REQ-ISS-020): the triage
 * label, the status labels by role, and each stage's marker with its comment id. Markers count only
 * in the runner's own comments (REQ-ISS-024).
 */
export function readState(gh, number, policy, comments, runner) {
  const labels = gh.getLabels(number);
  const names = labelNames(policy);
  const stages = {};
  for (const c of byRunner(comments ?? gh.listComments(number), runner ?? gh.whoami())) {
    const marker = parseMarker(c.body);
    if (marker?.stage) stages[marker.stage] = { ...marker, commentId: c.id };
  }
  return {
    label: TRIAGE.map((role) => names[role]).find((name) => labels.includes(name)) ?? null,
    status: STATUS.filter((role) => labels.includes(names[role])),
    stages,
  };
}
