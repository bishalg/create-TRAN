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
import { realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { guardChanges, parseNumstat } from './guard.mjs';
import { chooseHarness, repoSlug } from './harness.mjs';
import { changesSince, liveIo, runTask, taskFromBranch } from './run.mjs';
import { defaultBranch, git, readJson } from './shell.mjs';
import { runSignal, SIGNALS } from './signals.mjs';
import { checkAll, LEARNINGS, loadTasks, TASKS_DIR, tasksForCron } from './tasks.mjs';

// The public surface, unchanged by the split into modules: importers keep using './agents.mjs'.
export {
  checkAll,
  checkLearnings,
  checkSchedules,
  DELIVERABLES,
  HARNESSES,
  LEARNINGS,
  loadTasks,
  MODES,
  outDir,
  parseFrontmatter,
  pnpmScript,
  TASKS_DIR,
  tasksForCron,
  TRIGGERS,
  validateTask,
  WORKFLOW,
  workflowCrons,
} from './tasks.mjs';
export {
  evaluateSignal,
  plannedRequirements,
  runSignal,
  SIGNALS,
  survivingMutants,
  truncate,
  untranslatedStrings,
} from './signals.mjs';
export { buildPrompt, chooseHarness, harnessCommand, repoSlug } from './harness.mjs';
export { globToRegExp, guardChanges, matchesAny, parseNumstat } from './guard.mjs';
export { branchName, openPrsFor, prBody, readHandoff, runTask, taskFromBranch } from './run.mjs';

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

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
