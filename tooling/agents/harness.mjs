/** What the agent is told (REQ-AGT-004) and how each harness is started headless (REQ-AGT-005). */
import { HARNESSES, LEARNINGS, outDir } from './tasks.mjs';

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

/** `--harness`, then `AGENT_HARNESS`, then the policy's `defaultHarness`, then Claude Code. */
export function chooseHarness(flagValue, env, policy) {
  return flagValue ?? env.AGENT_HARNESS ?? policy.defaultHarness ?? 'claude';
}
