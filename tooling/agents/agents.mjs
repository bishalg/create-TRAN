#!/usr/bin/env node
/**
 * Evidence-driven agent tasks (ADR-0032, spec 015). Harness-neutral: the model only edits; this
 * runner decides whether to start it, what it is told, and whether its change is kept.
 *
 *   pnpm agents list                              tasks, triggers and schedules
 *   pnpm agents check                             validate task files, workflow crons, learnings
 *   pnpm agents signal <task|built-in>            run a signal and print its evidence
 *   pnpm agents run <task> [--harness <name>]     signal → prompt → harness → guard → gates → commit
 *                          [--dry-run] [--publish] [--pr <number>]
 *   pnpm agents guard [--task <name>] [--base <ref>] [--committed]
 *   pnpm agents due --cron '<expr>'               tasks a workflow cron should run
 *
 * Harnesses: claude, codex, gemini, pi, jules, custom (AGENT_CMD, prompt on stdin).
 * AGENT_HARNESS overrides the policy's defaultHarness; AGENT_HARNESS_ARGS adds arguments (a model, a profile).
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseRequirements } from '../spec-check/spec-check.mjs';

export const TRIGGERS = ['schedule', 'pull_request', 'manual'];
export const MODES = ['edit', 'read-only'];
export const DELIVERABLES = ['pr', 'report'];
export const HARNESSES = ['claude', 'codex', 'gemini', 'pi', 'jules', 'custom'];
const REQUIRED = ['name', 'summary', 'trigger', 'signal', 'mode', 'deliverable', 'gates'];
const OPTIONAL = [
  'schedule',
  'scope',
  'allow',
  'skills',
  'max_changed_lines',
  'evidence_lines',
  'timeout_minutes',
];
const KNOWN = new Set([...REQUIRED, ...OPTIONAL]);
const LISTS = ['gates', 'scope', 'allow', 'skills'];
const NUMBERS = ['max_changed_lines', 'evidence_lines', 'timeout_minutes'];
/** pnpm's own commands: `pnpm audit` is not a package.json script. */
const PNPM_COMMANDS = new Set([
  'add',
  'audit',
  'dlx',
  'exec',
  'install',
  'outdated',
  'remove',
  'up',
  'update',
  'why',
]);

export const TASKS_DIR = '.agents/tasks';
export const WORKFLOW = '.github/workflows/agents.yml';
export const LEARNINGS = 'docs/LEARNINGS.md';
export const outDir = (name) => `.agents/out/${name}`;

// ── Task files ──────────────────────────────────────────────────────────────────────────────────

/**
 * A deliberately small YAML subset: `key: value`, quoted strings, integers, and lists written as
 * `[a, b]` (on one line or several, as Prettier wraps them) or as `- item` lines.
 */
export function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) throw new Error('no frontmatter: the file must start with a --- block');
  const data = {};
  const lines = match[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trimEnd();
    if (!line.trim()) continue;
    const pair = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!pair)
      throw new Error(`frontmatter line ${i + 2}: expected "key: value", got "${lines[i]}"`);
    let value = pair[2].trim();
    // Prettier moves a long list's opening bracket to the next line.
    if (value === '' && /^\s+\[/.test(lines[i + 1] ?? '')) value = stripComment(lines[++i]).trim();
    if (value.startsWith('[')) {
      while (!value.endsWith(']') && i + 1 < lines.length)
        value += ` ${stripComment(lines[++i]).trim()}`;
    } else if (value === '') {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1]))
        items.push(
          parseScalar(
            stripComment(lines[++i])
              .replace(/^\s+-\s+/, '')
              .trim()
          )
        );
      if (items.length) {
        data[pair[1]] = items;
        continue;
      }
    }
    data[pair[1]] = parseValue(value);
  }
  return { data, body: match[2].trim() };
}

/** Each character outside quotes, with its index; `onChar` returns true to stop. */
function scan(text, onChar) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) quote = c === quote ? null : quote;
    else if (c === "'" || c === '"') quote = c;
    else if (onChar(c, i)) return i;
  }
  return -1;
}

function stripComment(line) {
  const at = scan(line, (c, i) => c === '#' && (i === 0 || /\s/.test(line[i - 1])));
  return at === -1 ? line : line.slice(0, at);
}

function parseValue(raw) {
  const value = raw.trim();
  if (!value.startsWith('[')) return parseScalar(value);
  if (!value.endsWith(']')) throw new Error(`unterminated list: ${value}`);
  const inner = value.slice(1, -1);
  const items = [];
  let start = 0;
  scan(inner, (c, i) => {
    if (c === ',') {
      items.push(inner.slice(start, i));
      start = i + 1;
    }
    return false;
  });
  items.push(inner.slice(start));
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseScalar);
}

function parseScalar(value) {
  if (/^(['"]).*\1$/.test(value)) return value.slice(1, -1);
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Task files from the working tree, or through `read` from anywhere else: the guard reads them from
 * the base commit, so a branch cannot loosen the rules it is judged by.
 */
export function loadTasks(root, read = (path) => readFileSync(join(root, path), 'utf8'), files) {
  const names = files ?? readdirSync(join(root, TASKS_DIR));
  return names
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const path = `${TASKS_DIR}/${file}`;
      try {
        return { file: path, ...parseFrontmatter(read(path)) };
      } catch (error) {
        return { file: path, data: {}, body: '', parseError: error.message };
      }
    });
}

const isCron = (value) =>
  typeof value === 'string' &&
  value.trim().split(/\s+/).length === 5 &&
  /^[\d*/,\- ]+$/.test(value);

/** The pnpm script a command runs, or null (`pnpm test -- x` → `test`; `pnpm audit` → null). */
export function pnpmScript(command) {
  const match = /^pnpm\s+(?:run\s+)?([^\s-]\S*)/.exec(command.trim());
  return match && !PNPM_COMMANDS.has(match[1]) ? match[1] : null;
}

/** REQ-AGT-001: everything wrong with one task file, as `file: problem` lines. */
export function validateTask(task, ctx) {
  const errors = [];
  const at = (problem) => errors.push(`${task.file}: ${problem}`);
  if (task.parseError) {
    at(task.parseError);
    return errors;
  }
  const d = task.data;
  for (const key of REQUIRED) if (d[key] === undefined || d[key] === '') at(`missing "${key}"`);
  for (const key of Object.keys(d)) if (!KNOWN.has(key)) at(`unknown field "${key}"`);
  for (const key of LISTS)
    if (d[key] !== undefined && !Array.isArray(d[key])) at(`"${key}" must be a [list]`);
  for (const key of NUMBERS)
    if (d[key] !== undefined && !(Number.isInteger(d[key]) && d[key] > 0))
      at(`"${key}" must be a positive whole number`);
  if (d.name !== undefined) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(d.name))) at('"name" must be kebab-case');
    if (`${d.name}.md` !== basename(task.file)) at(`"name: ${d.name}" must match the file name`);
  }
  const oneOf = (key, values) => {
    if (d[key] !== undefined && !values.includes(d[key]))
      at(`"${key}: ${d[key]}" must be one of ${values.join(', ')}`);
  };
  oneOf('trigger', TRIGGERS);
  oneOf('mode', MODES);
  oneOf('deliverable', DELIVERABLES);

  if (d.trigger === 'schedule' && !isCron(d.schedule))
    at('a schedule task needs a five-field cron in "schedule"');
  if (d.trigger !== 'schedule' && d.schedule !== undefined)
    at('"schedule" only applies to "trigger: schedule"');

  const gates = Array.isArray(d.gates) ? d.gates : [];
  if (d.mode === 'edit') {
    if (!Array.isArray(d.scope) || d.scope.length === 0)
      at('an edit task needs a "scope": the paths it may change');
    if (d.deliverable !== 'pr') at('an edit task delivers a pull request ("deliverable: pr")');
    if (gates.length === 0) at('an edit task needs at least one gate');
  }
  if (d.mode === 'read-only') {
    if (d.scope !== undefined || d.allow !== undefined)
      at('a read-only task changes nothing: drop "scope" and "allow"');
    if (d.deliverable === 'pr')
      at('a read-only task cannot open a pull request ("deliverable: report")');
  }
  for (const path of Array.isArray(d.scope) ? d.scope : [])
    if (!ctx.exists(path)) at(`scope path "${path}" does not exist`);
  for (const skill of Array.isArray(d.skills) ? d.skills : [])
    if (!ctx.skills.has(skill)) at(`skill "${skill}" is not in .agents/skills/`);

  const signal = typeof d.signal === 'string' ? d.signal : '';
  const builtIn = signal !== '' && !/\s/.test(signal);
  if (builtIn && !SIGNALS[signal])
    at(
      `"signal: ${signal}" is not a built-in (${Object.keys(SIGNALS).join(', ')}); a command needs arguments`
    );
  for (const command of [...(builtIn ? [] : [signal]), ...gates]) {
    const script = command && pnpmScript(String(command));
    if (script && !ctx.scripts.has(script))
      at(`"${command}" runs pnpm script "${script}", which package.json does not define`);
  }
  if (!task.body) at('the body is empty: tell the agent what to do');
  return errors;
}

// ── Schedules (REQ-AGT-002) ─────────────────────────────────────────────────────────────────────

export const workflowCrons = (yaml) =>
  [...yaml.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);

export function checkSchedules(tasks, crons) {
  const scheduled = tasks.filter((task) => task.data.trigger === 'schedule');
  const errors = [];
  for (const task of scheduled)
    if (!crons.includes(task.data.schedule))
      errors.push(`${task.file}: cron '${task.data.schedule}' is not in ${WORKFLOW}`);
  for (const cron of crons)
    if (!scheduled.some((task) => task.data.schedule === cron))
      errors.push(`${WORKFLOW}: cron '${cron}' belongs to no task`);
  return errors;
}

export const tasksForCron = (tasks, cron) =>
  tasks
    .filter((task) => task.data.trigger === 'schedule' && task.data.schedule === cron)
    .map((task) => task.data.name);

// ── Learnings (REQ-AGT-009) ─────────────────────────────────────────────────────────────────────

export function checkLearnings(markdown, file = LEARNINGS) {
  const errors = [];
  const entries = markdown.split(/^## /m).slice(1);
  for (const entry of entries) {
    const [heading, ...rest] = entry.split('\n');
    const body = rest.join('\n');
    const match = /^(\d{4}-\d{2}-\d{2}) - \S.*$/.exec(heading.trim());
    if (!match || Number.isNaN(Date.parse(match[1])))
      errors.push(`${file}: "## ${heading.trim()}" must read "## YYYY-MM-DD - Title"`);
    for (const label of ['Learning', 'Action'])
      if (!new RegExp(`^\\*\\*${label}:\\*\\* \\S`, 'm').test(body))
        errors.push(`${file}: "## ${heading.trim()}" needs a "**${label}:** …" line`);
  }
  return { entries: entries.length, errors };
}

// ── Signals (REQ-AGT-003) ───────────────────────────────────────────────────────────────────────

/** Keeps the first `maxLines` lines and says how many were cut. */
export function truncate(text, maxLines) {
  const lines = text.replace(/\s+$/, '').split('\n');
  if (lines.length <= maxLines) return lines.join('\n');
  return [
    ...lines.slice(0, maxLines),
    `… ${lines.length - maxLines} more lines cut (raise "evidence_lines" to see them)`,
  ].join('\n');
}

/** Exit 0: nothing to do. 126/127 or killed: the signal itself is broken. Anything else: work. */
export function evaluateSignal({ status, output }, maxLines) {
  const evidence = truncate(output ?? '', maxLines);
  if (status === 0) return { kind: 'none', status, evidence };
  if (status === null || status === 126 || status === 127)
    return { kind: 'broken', status, evidence };
  return { kind: 'work', status, evidence };
}

export function plannedRequirements(requirements) {
  const planned = requirements.filter((r) => r.status === 'planned');
  return planned.length
    ? {
        status: 1,
        output: planned.map((r) => `${r.id} [planned] ${r.title} (${r.file})`).join('\n'),
      }
    : { status: 0, output: 'no [planned] requirements' };
}

const flatten = (object, prefix = '') =>
  Object.entries(object).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]]
  );

/** `dictionaries`: { en: { 'common.title': 'Vote' }, ne: { … } }. English is the base (ADR-0020). */
export function untranslatedStrings(dictionaries, allow = []) {
  const english = dictionaries.en ?? {};
  const found = Object.keys(dictionaries)
    .filter((locale) => locale !== 'en')
    .sort()
    .flatMap((locale) =>
      Object.entries(dictionaries[locale])
        .filter(([key, value]) => value === english[key] && !allow.includes(key))
        .map(([key, value]) => `${locale} ${key}: ${JSON.stringify(value)}`)
    );
  return found.length
    ? { status: 1, output: found.join('\n') }
    : { status: 0, output: 'every string is translated' };
}

/**
 * cargo-mutants' `missed.txt` (paths from the workspace root) and Stryker's JSON report (paths from
 * its package, `strykerRoot`), either of which may be absent.
 */
export function survivingMutants({ cargoMissed, strykerJson, strykerRoot = '' }) {
  const lines = (cargoMissed ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => `rust: ${line}`);
  for (const [file, { mutants = [] }] of Object.entries(strykerJson?.files ?? {}))
    for (const m of mutants.filter((mutant) => mutant.status === 'Survived'))
      lines.push(
        `ts: ${strykerRoot}${file}:${m.location.start.line}: ${m.mutatorName} → ${JSON.stringify(m.replacement ?? '')}`
      );
  if (lines.length) return { status: 1, output: lines.join('\n') };
  const none = cargoMissed === undefined && strykerJson === undefined;
  return {
    status: 0,
    output: none
      ? 'no mutation report: run `cargo mutants` or `pnpm --filter @tran/core mutation` first'
      : 'no surviving mutants',
  };
}

const sh = (root, command, env = {}) => {
  const result = spawnSync('sh', ['-c', command], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined);

/** Built-in signals: each returns { status, output }, exit-code style. */
export const SIGNALS = {
  'planned-requirements': (root) => {
    const dir = join(root, 'docs/specs');
    const files = readdirSync(dir).filter((file) => /^\d{3}-.+\.md$/.test(file));
    return plannedRequirements(
      files.flatMap((file) =>
        parseRequirements(readFileSync(join(dir, file), 'utf8'), `docs/specs/${file}`)
      )
    );
  },
  'untranslated-strings': (root, policy) => {
    const dir = join(root, 'locales');
    const dictionaries = {};
    for (const locale of readdirSync(dir).filter((name) => !name.startsWith('.')))
      dictionaries[locale] = Object.fromEntries(
        readdirSync(join(dir, locale))
          .filter((file) => file.endsWith('.json'))
          .flatMap((file) =>
            flatten(readJson(join(dir, locale, file)), `${file.replace(/\.json$/, '')}.`)
          )
      );
    return untranslatedStrings(dictionaries, policy.signals?.['untranslated-strings']?.allow);
  },
  'mutants-missed': (root) => {
    const missed = join(root, 'mutants.out/missed.txt');
    return survivingMutants({
      cargoMissed: existsSync(missed) ? readFileSync(missed, 'utf8') : undefined,
      strykerJson: readJson(join(root, 'packages/core-ts/reports/mutation/mutation.json')),
      strykerRoot: 'packages/core-ts/',
    });
  },
  /** The change under review: AGENT_BASE (CI sets the pull request base), else the default branch. */
  'pr-diff': (root) => {
    const base = process.env.AGENT_BASE || defaultBranch(root);
    const diff = sh(
      root,
      `git diff --no-color --stat ${base}...HEAD && git diff --no-color ${base}...HEAD`
    );
    if (diff.status !== 0) return { status: 127, output: diff.output };
    return diff.output.trim()
      ? { status: 1, output: diff.output }
      : { status: 0, output: `no changes against ${base}` };
  },
  /** Every audit tool that is installed; findings from any of them are work. */
  'dependency-audit': (root) => {
    const parts = [sh(root, 'pnpm audit --audit-level high')];
    if (sh(root, 'cargo audit --version').status === 0) parts.push(sh(root, 'cargo audit'));
    const found = parts.filter((part) => part.status !== 0);
    return found.length
      ? { status: 1, output: found.map((part) => part.output).join('\n') }
      : { status: 0, output: 'no known vulnerabilities at high severity or above' };
  },
};

export function runSignal(root, signal, policy) {
  return SIGNALS[signal] ? SIGNALS[signal](root, policy) : sh(root, signal);
}

function defaultBranch(root) {
  const head = sh(root, 'git symbolic-ref --short refs/remotes/origin/HEAD');
  return head.status === 0 ? head.output.trim() : 'origin/main';
}

// ── Prompt (REQ-AGT-004) ────────────────────────────────────────────────────────────────────────

export function buildPrompt({ task, policy, rules, signal }) {
  const d = task.data;
  const readOnly = d.mode === 'read-only';
  const budget = d.max_changed_lines ?? policy.maxChangedLines;
  const handoff = `${outDir(d.name)}/result.md`;
  const list = (items) => items.map((item) => `\`${item}\``).join(', ');
  const limits = readOnly
    ? [
        '- **Mode: read-only.** Do not create, change or delete any file. Your final answer is the deliverable.',
      ]
    : [
        `- **Mode: edit.** Change only paths under: ${list(d.scope)}.`,
        `- Never change: ${list(policy.protected)}${d.allow?.length ? `, except ${list(d.allow)}` : ''}.`,
        `- At most ${budget} changed lines in total. A smaller change is better.`,
        '- Do not commit, push or switch branches: the runner does that after checking your work.',
        `- These gates run after you, and your change is dropped unless all pass: ${list(d.gates)}. Run them yourself first.`,
      ];
  const skills = (d.skills ?? []).map((skill) => `\`.agents/skills/${skill}/SKILL.md\``);
  return [
    `# Agent task: ${d.name}`,
    '',
    `${d.summary}`,
    '',
    'You are running unattended. Nobody can answer a question during this run, so do not ask one: decide, or stop',
    'and explain in the hand-off.',
    '',
    '## Limits',
    '',
    ...limits,
    '- Work only from the evidence below. If it does not justify a change, make no change. Doing nothing is a correct',
    '  outcome; an invented improvement is not.',
    '- Never weaken, skip or delete a test, a threshold, a budget or a gate to make something pass.',
    `- Read \`${LEARNINGS}\` before you start. Add an entry only for a lesson that would change how the next agent or`,
    '  person works here, in its format. Routine work is not a learning.',
    ...(skills.length
      ? [`- Skills for this task, read when you touch their area: ${skills.join(', ')}.`]
      : []),
    '',
    '## Task',
    '',
    task.body,
    '',
    `## Evidence: \`${d.signal}\` exited ${signal.status}`,
    '',
    '```text',
    signal.evidence,
    '```',
    '',
    '## Hand-off',
    '',
    ...(readOnly
      ? ['Reply with the report in the format the task asks for, and nothing else.']
      : [
          `When you finish, write \`${handoff}\` (the folder is gitignored):`,
          '',
          '- Line 1: a pull request title under 70 characters, in conventional-commit form, for example',
          '  `test(core): cover the minimum age boundary (REQ-RULE-003)`.',
          '- Then sections **What**, **Why** (the evidence that justified it), **Verification** (the commands you ran and',
          '  their result) and **Risk**.',
          '',
          `If you decide not to change anything, write only \`NO-CHANGE: <one-sentence reason>\` on line 1, then any detail`,
          'a person needs to act on it.',
        ]),
    '',
    '## Repository rules (AGENTS.md)',
    '',
    rules.trim(),
    '',
  ].join('\n');
}

// ── Harnesses (REQ-AGT-005) ─────────────────────────────────────────────────────────────────────

/** Tools Claude Code may use without asking in an edit task: build and test, never git writes. */
const CLAUDE_EDIT_TOOLS = [
  'Bash(pnpm:*)',
  'Bash(cargo:*)',
  'Bash(node:*)',
  'Bash(git diff:*)',
  'Bash(git status:*)',
  'Bash(git log:*)',
];

/**
 * How to start each harness headless. `stdin`: the prompt is piped in. `async`: the harness runs
 * elsewhere and opens its own pull request, so this runner cannot verify it.
 */
export function harnessCommand(harness, { readOnly, promptFile, repo, custom, extraArgs = [] }) {
  switch (harness) {
    case 'claude':
      return {
        command: 'claude',
        args: [
          '-p',
          ...(readOnly
            ? ['--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'Bash']
            : ['--permission-mode', 'acceptEdits', '--allowedTools', ...CLAUDE_EDIT_TOOLS]),
          ...extraArgs,
        ],
        stdin: true,
      };
    case 'codex':
      return {
        command: 'codex',
        args: ['exec', '--sandbox', readOnly ? 'read-only' : 'workspace-write', ...extraArgs, '-'],
        stdin: true,
      };
    case 'gemini':
      return {
        command: 'gemini',
        args: [
          '--approval-mode',
          readOnly ? 'plan' : 'auto_edit',
          ...extraArgs,
          '-p',
          'Carry out the task above.',
        ],
        stdin: true,
      };
    case 'pi':
      return {
        command: 'pi',
        args: [
          '-p',
          '--no-session',
          ...(readOnly ? ['--tools', 'read'] : []),
          ...extraArgs,
          `@${promptFile}`,
          'Carry out the task in the attached file.',
        ],
        stdin: false,
      };
    case 'jules':
      if (!repo)
        throw new Error(
          'jules needs the GitHub repository: set AGENT_REPO=owner/name or an origin remote'
        );
      return {
        command: 'jules',
        args: ['remote', 'new', '--repo', repo, ...extraArgs],
        stdin: true,
        async: true,
      };
    case 'custom':
      if (!custom)
        throw new Error(
          'the custom harness runs $AGENT_CMD with the prompt on stdin; AGENT_CMD is not set'
        );
      return { command: 'sh', args: ['-c', custom], stdin: true };
    default:
      throw new Error(`unknown harness "${harness}" (${HARNESSES.join(', ')})`);
  }
}

/** `git@github.com:o/r.git` or `https://github.com/o/r` → `o/r`. */
export const repoSlug = (url) =>
  /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null;

// ── Guard (REQ-AGT-007) ─────────────────────────────────────────────────────────────────────────

/** `dir/` is a prefix, `**\/x` matches at any depth, `*` stays inside one path segment. */
export function globToRegExp(pattern) {
  const prefix = pattern.endsWith('/');
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?');
  return new RegExp(`^${source}${prefix ? '' : '$'}`);
}
export const matchesAny = (path, patterns) =>
  patterns.some((pattern) => globToRegExp(pattern).test(path));

/** `changes`: [{ path, lines }]. Returns the problems; empty means the change may be kept. */
export function guardChanges(changes, task, policy) {
  const d = task.data;
  if (d.mode === 'read-only')
    return changes.length
      ? [`a read-only task changed files: ${changes.map((c) => c.path).join(', ')}`]
      : [];
  const errors = [];
  for (const { path } of changes) {
    if (!matchesAny(path, d.scope ?? []))
      errors.push(`${path}: outside the task's scope (${(d.scope ?? []).join(', ')})`);
    if (matchesAny(path, policy.protected) && !matchesAny(path, d.allow ?? []))
      errors.push(`${path}: protected by .agents/policy.json`);
  }
  const lines = changes.reduce((sum, change) => sum + change.lines, 0);
  const budget = d.max_changed_lines ?? policy.maxChangedLines;
  if (lines > budget) errors.push(`${lines} changed lines, over the budget of ${budget}`);
  return errors;
}

/** `git diff --numstat` lines plus untracked files; binary files count as one line. */
export function parseNumstat(numstat) {
  return numstat
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...path] = line.split('\t');
      const count = (n) => (n === '-' ? 0 : Number(n));
      return { path: path.join('\t'), lines: Math.max(1, count(added) + count(removed)) };
    });
}

// ── Branches and pull requests (REQ-AGT-006, REQ-AGT-008) ───────────────────────────────────────

export function branchName(task, prefix, date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${prefix}${task}-${stamp}`;
}

/** The task a branch belongs to: `agent/spec-gap-20261021-0517` → `spec-gap`. Longest name wins. */
export function taskFromBranch(branch, prefix, names) {
  if (!branch.startsWith(prefix)) return null;
  const rest = branch.slice(prefix.length);
  const owners = names.filter((name) => rest === name || rest.startsWith(`${name}-`));
  return owners.sort((a, b) => b.length - a.length)[0] ?? null;
}

export const openPrsFor = (name, prefix, prs, names = [name]) =>
  prs.filter((pr) => taskFromBranch(pr.headRefName, prefix, names) === name);

export function readHandoff(text) {
  if (text === null || text === undefined || !text.trim()) return { missing: true };
  const [first, ...rest] = text.trim().split('\n');
  const body = rest.join('\n').trim();
  const noChange = /^NO-CHANGE:\s*(.*)$/.exec(first.trim());
  if (noChange) return { noChange: true, reason: noChange[1].trim(), body };
  return {
    title: first
      .replace(/^#+\s*/, '')
      .replace(/^`|`$/g, '')
      .trim(),
    body,
  };
}

export function prBody({ task, harness, signal, gates, lines, handoff }) {
  const d = task.data;
  return [
    handoff.body || '_The agent wrote no description._',
    '',
    '---',
    '',
    `**Agent task:** [\`${d.name}\`](../blob/HEAD/${task.file}) · **Harness:** ${harness} · **Changed lines:** ${lines}`,
    '',
    `**Signal:** \`${d.signal}\` exited ${signal.status}.`,
    '',
    '<details><summary>Evidence the agent was given</summary>',
    '',
    '```text',
    truncate(signal.evidence, 60),
    '```',
    '',
    '</details>',
    '',
    '**Verified by the runner, not the agent:** the guard passed (scope, protected paths, line budget), then:',
    '',
    ...gates.map((gate) => `- ✅ \`${gate.command}\``),
    '',
    'Draft until a person reviews it. Agent pull requests never merge themselves (ADR-0032).',
  ].join('\n');
}

// ── Run (REQ-AGT-003, -005, -006, -008) ─────────────────────────────────────────────────────────

/**
 * One run of one task. Every side effect goes through `io`, so the decision logic is testable:
 * signal → open-PR check → prompt → harness → (edit) hand-off, guard, gates → commit → publish.
 */
export function runTask(task, opts, io) {
  const d = task.data;
  const { harness, policy, publish = false, dryRun = false, pr } = opts;
  const readOnly = d.mode === 'read-only';
  const out = outDir(d.name);
  const fail = (message, extra = {}) => ({ outcome: 'failed', message, ...extra });

  if (!readOnly && !dryRun && !io.isClean())
    return fail(
      'the working tree has uncommitted changes: commit or stash them first, so the agent’s change can be measured'
    );

  const signal = evaluateSignal(
    io.runSignal(d.signal),
    d.evidence_lines ?? policy.evidenceMaxLines
  );
  if (signal.kind === 'none')
    return {
      outcome: 'no-signal',
      message: `${d.name}: no signal from \`${d.signal}\`, nothing to do`,
    };
  if (signal.kind === 'broken')
    return fail(
      `signal \`${d.signal}\` could not run (exit ${signal.status}); the agent was not started\n${signal.evidence}`
    );

  if (publish && d.deliverable === 'pr') {
    const prs = io.openPrs();
    if (prs === null)
      io.log('could not list open pull requests (is gh installed and signed in?); continuing');
    else {
      const mine = openPrsFor(d.name, policy.branchPrefix, prs, opts.taskNames);
      if (mine.length)
        return {
          outcome: 'skipped',
          message: `${d.name} already has an open pull request: ${mine.map((p) => p.url).join(', ')}`,
        };
    }
  }

  const prompt = buildPrompt({ task, policy, rules: io.readFile('AGENTS.md') ?? '', signal });
  io.writeFile(`${out}/prompt.md`, prompt);
  if (dryRun)
    return {
      outcome: 'dry-run',
      message: `prompt written to ${out}/prompt.md (${prompt.split('\n').length} lines)`,
      prompt,
    };

  const command = harnessCommand(harness, {
    ...opts.harnessOptions,
    readOnly,
    promptFile: `${out}/prompt.md`,
  });
  io.removeFile(`${out}/result.md`);
  // `startBranch` returns the name it used: it adds a suffix when that branch already exists.
  const branch =
    !readOnly && !command.async
      ? io.startBranch(branchName(d.name, policy.branchPrefix, opts.now))
      : null;
  const before = io.status();
  const result = io.runHarness(
    command,
    prompt,
    (d.timeout_minutes ?? policy.timeoutMinutes) * 60_000
  );
  io.writeFile(`${out}/harness.log`, result.output ?? '');

  if (command.async)
    return {
      outcome: 'dispatched',
      message:
        `sent to ${harness}; it opens its own pull request, which the guard job checks\n${result.output ?? ''}`.trim(),
    };
  if (result.status !== 0)
    return fail(
      `${harness} exited with ${result.status === null ? 'a timeout' : result.status}; see ${out}/harness.log`,
      { branch }
    );

  if (readOnly) {
    if (io.status() !== before)
      return fail('a read-only task changed the working tree; nothing was published');
    const report = (result.output ?? '').trim();
    io.writeFile(`${out}/report.md`, report);
    if (publish && pr) {
      io.comment(
        pr,
        `${report}\n\n---\n_Agent task \`${d.name}\` via ${harness}; read-only (ADR-0032)._`
      );
      return { outcome: 'published', message: `review posted on #${pr}` };
    }
    return { outcome: 'reported', message: `report written to ${out}/report.md`, report };
  }

  const handoff = readHandoff(io.readFile(`${out}/result.md`));
  const changes = io.changes();
  if (handoff.noChange && changes.length)
    return fail(
      `the agent wrote NO-CHANGE but changed ${changes.length} file(s); left on ${branch} for a person`,
      { branch }
    );
  if (handoff.noChange || changes.length === 0) {
    io.discardBranch(branch);
    return {
      outcome: 'no-change',
      message: `${d.name}: ${handoff.noChange ? handoff.reason : 'the agent changed nothing'}`,
      detail: handoff.body,
    };
  }
  if (handoff.missing)
    return fail(`the agent wrote no hand-off at ${out}/result.md; left on ${branch}`, { branch });

  const lines = changes.reduce((sum, change) => sum + change.lines, 0);
  const problems = guardChanges(changes, task, policy);
  const gates = problems.length
    ? []
    : d.gates.map((gate) => ({ command: gate, ...io.runGate(gate) }));
  for (const gate of gates.filter((g) => g.status !== 0))
    problems.push(`gate failed: ${gate.command}\n${truncate(gate.output ?? '', 40)}`);
  if (problems.length) {
    io.writeFile(`${out}/verification.md`, problems.join('\n\n'));
    return fail(
      `the change was not kept; left on ${branch} for a person:\n- ${problems.join('\n- ')}`,
      { branch }
    );
  }

  io.commit(
    `${handoff.title}\n\n${handoff.body}\n\nAgent-Task: ${d.name}\nAgent-Harness: ${harness}`
  );
  if (!publish) {
    io.restoreBranch();
    return {
      outcome: 'committed',
      message: `committed on ${branch}; review it, then push it or rerun with --publish`,
      branch,
    };
  }
  const url = io.publish({
    branch,
    title: handoff.title,
    body: prBody({ task, harness, signal, gates, lines, handoff }),
  });
  io.restoreBranch();
  return { outcome: 'published', message: `draft pull request: ${url}`, branch };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

function context(root) {
  const skillsDir = join(root, '.agents/skills');
  return {
    exists: (path) => existsSync(join(root, path)),
    skills: new Set(
      existsSync(skillsDir)
        ? readdirSync(skillsDir).filter((s) => existsSync(join(skillsDir, s, 'SKILL.md')))
        : []
    ),
    scripts: new Set(
      Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {})
    ),
  };
}

/** `--harness`, then `AGENT_HARNESS`, then the policy's `defaultHarness`, then Claude Code. */
export function chooseHarness(flagValue, env, policy) {
  return flagValue ?? env.AGENT_HARNESS ?? policy.defaultHarness ?? 'claude';
}

export function checkAll(root, policy = readJson(join(root, '.agents/policy.json')) ?? {}) {
  const tasks = loadTasks(root);
  const ctx = context(root);
  const errors = tasks.flatMap((task) => validateTask(task, ctx));
  if (policy.defaultHarness !== undefined && !HARNESSES.includes(policy.defaultHarness))
    errors.push(
      `.agents/policy.json: defaultHarness "${policy.defaultHarness}" is not one of ${HARNESSES.join(', ')}`
    );
  const workflow = join(root, WORKFLOW);
  errors.push(
    ...checkSchedules(
      tasks,
      existsSync(workflow) ? workflowCrons(readFileSync(workflow, 'utf8')) : []
    )
  );
  const learnings = join(root, LEARNINGS);
  if (!existsSync(learnings)) errors.push(`${LEARNINGS}: missing`);
  else errors.push(...checkLearnings(readFileSync(learnings, 'utf8')).errors);
  return { tasks, errors };
}

function git(root, args, input) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', input });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
}

function changesSince(root, base) {
  const tracked = parseNumstat(git(root, ['diff', '--numstat', '--no-renames', base]));
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
    .map((path) => ({
      path,
      lines: Math.max(1, readFileSync(join(root, path), 'utf8').split('\n').length),
    }));
  return [...tracked, ...untracked];
}

function liveIo(root) {
  let original = null;
  let base = null;
  const gh = (args, input) => spawnSync('gh', args, { cwd: root, encoding: 'utf8', input });
  return {
    isClean: () => git(root, ['status', '--porcelain']).trim() === '',
    status: () => git(root, ['status', '--porcelain']),
    runSignal: (signal) => runSignal(root, signal, readJson(join(root, '.agents/policy.json'))),
    openPrs: () => {
      const result = gh([
        'pr',
        'list',
        '--state',
        'open',
        '--json',
        'headRefName,url',
        '--limit',
        '200',
      ]);
      return result.status === 0 ? JSON.parse(result.stdout) : null;
    },
    readFile: (path) =>
      existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null,
    writeFile: (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    },
    removeFile: (path) => rmSync(join(root, path), { force: true }),
    startBranch: (wanted) => {
      original = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
      base = git(root, ['rev-parse', 'HEAD']).trim();
      const taken = (name) =>
        spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd: root })
          .status === 0;
      let branch = wanted;
      for (let n = 2; taken(branch); n++) branch = `${wanted}-${n}`;
      git(root, ['switch', '-c', branch]);
      return branch;
    },
    restoreBranch: () => original && git(root, ['switch', original]),
    discardBranch: (branch) => {
      if (!branch) return;
      git(root, ['switch', original]);
      git(root, ['branch', '-D', branch]);
    },
    runHarness: (command, prompt, timeout) => {
      process.stderr.write(`agents: starting ${command.command} ${command.args.join(' ')}\n`);
      const result = spawnSync(command.command, command.args, {
        cwd: root,
        encoding: 'utf8',
        input: command.stdin ? prompt : undefined,
        stdio: [command.stdin ? 'pipe' : 'ignore', 'pipe', 'inherit'],
        timeout,
        maxBuffer: 256 * 1024 * 1024,
      });
      if (result.error?.code === 'ENOENT')
        return { status: 127, output: `${command.command} is not installed` };
      return { status: result.status, output: result.stdout ?? '' };
    },
    changes: () => changesSince(root, base ?? 'HEAD'),
    runGate: (command) => {
      process.stderr.write(`agents: gate ${command}\n`);
      return sh(root, command);
    },
    commit: (message) => {
      git(root, ['add', '-A']);
      git(root, ['commit', '-F', '-'], message);
    },
    publish: ({ branch, title, body }) => {
      git(root, ['push', '-u', 'origin', branch]);
      const result = gh(
        [
          'pr',
          'create',
          '--draft',
          '--base',
          original,
          '--head',
          branch,
          '--title',
          title,
          '--body-file',
          '-',
        ],
        body
      );
      if (result.status !== 0) throw new Error(`gh pr create failed:\n${result.stderr}`);
      return result.stdout.trim();
    },
    comment: (number, body) => {
      const result = gh(['pr', 'comment', String(number), '--body-file', '-'], body);
      if (result.status !== 0) throw new Error(`gh pr comment failed:\n${result.stderr}`);
    },
    log: (message) => process.stderr.write(`agents: ${message}\n`),
  };
}

function flag(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

function main(root, argv) {
  const [command, target] = argv;
  const policy = readJson(join(root, '.agents/policy.json'));
  const tasks = loadTasks(root);
  const byName = (name) => {
    const task = tasks.find((t) => t.data.name === name);
    if (!task)
      throw new Error(
        `no task "${name}" in ${TASKS_DIR}/ (${tasks.map((t) => t.data.name).join(', ')})`
      );
    return task;
  };

  switch (command) {
    case 'list':
      for (const t of tasks) {
        const d = t.data;
        if (t.parseError) console.log(`${t.file}: ${t.parseError}`);
        else
          console.log(
            [
              d.name.padEnd(20),
              String(d.trigger).padEnd(12),
              String(d.schedule ?? '').padEnd(11),
              String(d.mode).padEnd(9),
              d.summary,
            ].join(' ')
          );
      }
      return 0;
    case 'check': {
      const { tasks: checked, errors } = checkAll(root);
      for (const error of errors) console.error(`✗ ${error}`);
      if (errors.length) return 1;
      console.log(`agents: ${checked.length} tasks, workflow crons and ${LEARNINGS} are valid`);
      return 0;
    }
    case 'signal': {
      const signal = SIGNALS[target] ? target : byName(target).data.signal;
      const result = runSignal(root, signal, policy);
      console.log(result.output.trim());
      return result.status;
    }
    case 'due': {
      for (const name of tasksForCron(tasks, flag(argv, '--cron') ?? '')) console.log(name);
      return 0;
    }
    case 'guard': {
      const base = flag(argv, '--base') ?? process.env.AGENT_BASE ?? defaultBranch(root);
      const committed = argv.includes('--committed');
      // --committed (CI): the branch's commits only, judged by the policy and tasks of the base.
      const show = (path) => git(root, ['show', `${base}:${path}`]);
      const rules = committed ? JSON.parse(show('.agents/policy.json')) : policy;
      const known = committed
        ? loadTasks(
            root,
            show,
            git(root, ['ls-tree', '--name-only', `${base}`, `${TASKS_DIR}/`])
              .split('\n')
              .filter(Boolean)
              .map((path) => basename(path))
          )
        : tasks;
      const branch =
        process.env.AGENT_BRANCH || git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
      const names = known.map((t) => t.data.name);
      const name = flag(argv, '--task') ?? taskFromBranch(branch, rules.branchPrefix, names);
      const task = known.find((t) => t.data.name === name);
      if (!task)
        throw new Error(
          `"${branch}" belongs to no task on ${committed ? base : 'this branch'} (${rules.branchPrefix}<task>-…); pass --task`
        );
      const changes = committed
        ? parseNumstat(git(root, ['diff', '--numstat', '--no-renames', `${base}...HEAD`]))
        : changesSince(root, base);
      const problems = guardChanges(changes, task, rules);
      for (const problem of problems) console.error(`✗ ${problem}`);
      if (problems.length) return 1;
      console.log(`agents: guard passed for ${name} (${changes.length} files)`);
      return 0;
    }
    case 'run': {
      const task = byName(target);
      const harness = chooseHarness(flag(argv, '--harness'), process.env, policy);
      const origin =
        spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).stdout ??
        '';
      const result = runTask(
        task,
        {
          harness,
          policy,
          publish: argv.includes('--publish'),
          dryRun: argv.includes('--dry-run'),
          pr: flag(argv, '--pr'),
          taskNames: tasks.map((t) => t.data.name),
          harnessOptions: {
            repo: process.env.AGENT_REPO || repoSlug(origin),
            custom: process.env.AGENT_CMD,
            extraArgs: (process.env.AGENT_HARNESS_ARGS ?? '').split(' ').filter(Boolean),
          },
        },
        liveIo(root)
      );
      (result.outcome === 'failed' ? console.error : console.log)(
        `agents: ${result.outcome}: ${result.message}`
      );
      return result.outcome === 'failed' ? 1 : 0;
    }
    default:
      console.error(
        'usage: agents list | check | signal <task|built-in> | run <task> [--harness h] [--dry-run] [--publish] [--pr n] | guard [--task t] [--base ref] | due --cron <expr>'
      );
      return 2;
  }
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    process.exitCode = main(process.cwd(), process.argv.slice(2));
  } catch (error) {
    console.error(`agents: ${error.message}`);
    process.exitCode = 1;
  }
}
