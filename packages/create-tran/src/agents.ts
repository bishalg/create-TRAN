import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The agent setup a new project starts with (ADR-0032, REQ-GEN-005):
 * - `sample`: the template's files as they are; GitHub Actions schedules stay off.
 * - `github`: the same files with the schedules on; `AGENTS_ENABLED=false` pauses them.
 * - `none`: the runner, tasks, workflow and their docs removed. `.agents/skills/` and
 *   `docs/LEARNINGS.md` stay: any agent or person working interactively still uses them.
 */
export const AGENT_SETUPS = ['sample', 'github', 'none'] as const;
export type AgentSetup = (typeof AGENT_SETUPS)[number];
export const DEFAULT_AGENT_SETUP: AgentSetup = 'sample';

export const AGENT_HARNESSES = ['claude', 'codex', 'gemini', 'pi'] as const;
export type AgentHarness = (typeof AGENT_HARNESSES)[number];
export const DEFAULT_AGENT_HARNESS: AgentHarness = 'claude';
/** The harnesses `.github/workflows/agents.yml` installs. */
export const CI_AGENT_HARNESSES: readonly AgentHarness[] = ['claude', 'codex', 'gemini'];

const POLICY = '.agents/policy.json';
const WORKFLOW = '.github/workflows/agents.yml';

/** Removed by `none`. */
const AGENT_ONLY = [
  '.agents/README.md',
  POLICY,
  '.agents/tasks',
  'tooling/agents',
  WORKFLOW,
  'docs/specs/015-agents.md',
  'docs/adr/0032-evidence-driven-agents.md',
];

/** Every path the setup reads, edits or removes. */
export const AGENT_PATHS = [
  ...AGENT_ONLY,
  '.agents/skills',
  '.github/workflows/ci.yml',
  '.gitignore',
  'AGENTS.md',
  'README.md',
  'docs/README.md',
  'docs/specs/README.md',
  'docs/LEARNINGS.md',
  'package.json',
];

/** Text that must not survive `none`: each names something it removed. */
export const AGENT_REFERENCES = [
  'tooling/agents',
  'agents:check',
  'pnpm agents',
  '.agents/README',
  '.agents/tasks',
  'agents.yml',
  'ADR-0032',
  '0032-evidence',
  '015-agents',
  'REQ-AGT',
];

type Edit =
  | { file: string; from: string; to: string }
  | { file: string; section: string }
  | { file: string; line: string };

const NONE_EDITS: Edit[] = [
  { file: 'AGENTS.md', section: '## Unattended agents' },
  { file: 'README.md', section: '## Unattended agents' },
  {
    file: 'README.md',
    from: '# agent tasks, policy and skills (any harness)',
    to: '# agent skills (any harness)',
  },
  {
    file: 'docs/README.md',
    from: '- **Agents:** [setup](../.agents/README.md) · **Lessons learned:**',
    to: '- **Lessons learned:**',
  },
  { file: 'docs/specs/README.md', line: '| [015 Agents](./015-agents.md)' },
  {
    file: '.github/workflows/ci.yml',
    line: '      - name: Agent tasks, workflow crons and learnings',
  },
  { file: '.github/workflows/ci.yml', line: '        run: pnpm run agents:check' },
  { file: '.gitignore', line: '# Agent runs (ADR-0032)' },
  { file: '.gitignore', line: '.agents/out/' },
  { file: 'docs/LEARNINGS.md', from: ' (ADR-0032, REQ-AGT-009)', to: '' },
  {
    file: 'docs/LEARNINGS.md',
    from: `Format, checked by \`pnpm agents:check\`: a \`## YYYY-MM-DD - Title\` heading, then a \`**Learning:**\` and an
  \`**Action:**\` line.`,
    to: `Format: a \`## YYYY-MM-DD - Title\` heading, then a \`**Learning:**\` and an \`**Action:**\` line.
 `,
  },
];

const GITHUB_EDITS: Edit[] = [
  {
    file: WORKFLOW,
    from: "vars.AGENTS_ENABLED == 'true'",
    to: "vars.AGENTS_ENABLED != 'false'",
  },
  {
    file: WORKFLOW,
    from: `# Off by default: this repo ships the setup as a sample. Schedules run only when the repository variable
# AGENTS_ENABLED is 'true'`,
    to: `# On: this project was created with \`create-tran --agents github\`. Schedules run unless the repository
# variable AGENTS_ENABLED is 'false'`,
  },
  {
    file: '.agents/README.md',
    from: `> **A sample, off by default.** Nothing here runs on its own: no scheduler is installed, and the GitHub Actions
> schedules stay idle until you set \`AGENTS_ENABLED\`. Fork the template, read this page, adapt the task files, then
> switch on the scheduler you want.`,
    to: `> **Scheduled on GitHub Actions.** This project was created with the schedules on: add the API key secret for
> your harness and they start, opening draft pull requests only. Set the repository variable \`AGENTS_ENABLED\` to
> \`false\` to pause them.`,
  },
];

/** Applies one edit; returns why it could not, so a template that drifted is reported, not skipped. */
function applyEdit(root: string, edit: Edit): string | undefined {
  const file = path.join(root, edit.file);
  if (!fs.existsSync(file)) {
    return `${edit.file}: missing`;
  }
  const text = fs.readFileSync(file, 'utf8');
  let next: string;
  if ('section' in edit) {
    const start = text.indexOf(`\n${edit.section}\n`);
    if (start < 0) {
      return `${edit.file}: section "${edit.section}" not found`;
    }
    const end = text.indexOf('\n## ', start + 1);
    next = end < 0 ? `${text.slice(0, start).trimEnd()}\n` : text.slice(0, start) + text.slice(end);
  } else if ('line' in edit) {
    const lines = text.split('\n');
    const kept: string[] = [];
    let removed = false;
    for (const line of lines) {
      if (line.startsWith(edit.line)) {
        removed = true;
        continue;
      }
      // Removing a block between two blank lines must not leave both behind.
      if (removed && line === '' && kept.at(-1) === '') {
        continue;
      }
      kept.push(line);
    }
    if (kept.length === lines.length) {
      return `${edit.file}: line "${edit.line}" not found`;
    }
    while (kept.length > 1 && kept.at(-1) === '' && kept.at(-2) === '') {
      kept.pop();
    }
    next = kept.join('\n');
  } else {
    if (!text.includes(edit.from)) {
      return `${edit.file}: "${edit.from.split('\n')[0]}" not found`;
    }
    next = text.replace(edit.from, edit.to);
  }
  fs.writeFileSync(file, next, 'utf8');
  return undefined;
}

function editPackageJson(root: string): void {
  const file = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};
  delete scripts.agents;
  delete scripts['agents:check'];
  for (const [name, command] of Object.entries(scripts)) {
    scripts[name] = command.replace(/ && pnpm (run )?agents:check/g, '');
  }
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function setDefaultHarness(root: string, harness: AgentHarness): void {
  const file = path.join(root, POLICY);
  const text = fs.readFileSync(file, 'utf8');
  // A text edit keeps the file's own formatting; JSON.stringify would reflow its arrays.
  fs.writeFileSync(
    file,
    text.replace(/"defaultHarness": "[^"]*"/, `"defaultHarness": "${harness}"`),
    'utf8'
  );
}

/**
 * Applies `setup` to a freshly copied template at `root`. Returns the edits that no longer match
 * the template (empty when all applied); the scaffold smoke test keeps that list empty.
 */
export function applyAgentSetup(root: string, setup: AgentSetup, harness: AgentHarness): string[] {
  // A template from before ADR-0032 has nothing to set up.
  if (!fs.existsSync(path.join(root, POLICY))) {
    return [];
  }
  if (setup === 'none') {
    for (const relative of AGENT_ONLY) {
      fs.rmSync(path.join(root, relative), { recursive: true, force: true });
    }
    editPackageJson(root);
    return NONE_EDITS.map((edit) => applyEdit(root, edit)).filter((e): e is string => !!e);
  }
  setDefaultHarness(root, harness);
  const edits = setup === 'github' ? GITHUB_EDITS : [];
  return edits.map((edit) => applyEdit(root, edit)).filter((e): e is string => !!e);
}

export function describeAgentSetup(setup: AgentSetup, harness: AgentHarness): string {
  if (setup === 'none') {
    return 'None';
  }
  return setup === 'github'
    ? `Scheduled on GitHub Actions, harness ${harness}`
    : `Sample in .agents/ (idle), harness ${harness}`;
}

export function validateAgentSetup(raw: string): AgentSetup | undefined {
  return (AGENT_SETUPS as readonly string[]).includes(raw) ? (raw as AgentSetup) : undefined;
}

export function validateAgentHarness(raw: string, setup: AgentSetup): AgentHarness | undefined {
  const allowed = setup === 'github' ? CI_AGENT_HARNESSES : AGENT_HARNESSES;
  return (allowed as readonly string[]).includes(raw) ? (raw as AgentHarness) : undefined;
}

/** The secret each GitHub Actions harness reads its API key from. */
export const AGENT_SECRETS: Record<string, string> = {
  claude: 'ANTHROPIC_API_KEY',
  codex: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};
