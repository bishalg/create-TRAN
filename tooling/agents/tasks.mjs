/** Task files (ADR-0032): the frontmatter parser, loading and validation, schedules, learnings. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readJson } from './shell.mjs';
import { SIGNALS } from './signals.mjs';

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

// ── Check (REQ-AGT-001, -002, -009) ─────────────────────────────────────────────────────────────

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
