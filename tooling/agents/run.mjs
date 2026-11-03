/** One run of one task: branches, the hand-off, pull requests, and the live side effects. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { guardChanges, parseNumstat } from './guard.mjs';
import { buildPrompt, harnessCommand } from './harness.mjs';
import { fitTemplate, missingTests } from './issue-commands.mjs';
import { git, readJson, sh } from './shell.mjs';
import { evaluateSignal, runSignal, truncate } from './signals.mjs';
import { outDir } from './tasks.mjs';

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

export const PR_TEMPLATE = '.github/pull_request_template.md';

// ── Run (REQ-AGT-003, -005, -006, -008) ─────────────────────────────────────────────────────────

/**
 * One run of one task. Every side effect goes through `io`, so the decision logic is testable:
 * signal → open-PR check → prompt → harness → (edit) hand-off, guard, gates → commit → publish.
 *
 * Issue runs (spec 020) add, each off by default: `branch` (the exact branch name), `prMatch` (a
 * head prefix: only those open pull requests block the run, not every one of the task),
 * `extraEvidence` (runner-written Markdown after the prompt, such as the approved plan),
 * `requireTests` (a code change needs a test change, REQ-ISS-010) and `closes` (an issue number:
 * the body starts `Closes #n` and follows the pull request template, REQ-ISS-009).
 */
export function runTask(task, opts, io) {
  const d = task.data;
  const { harness, policy, publish = false, dryRun = false, pr, prMatch, closes } = opts;
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
      const mine = prMatch
        ? prs.filter((p) => p.headRefName?.startsWith(prMatch))
        : openPrsFor(d.name, policy.branchPrefix, prs, opts.taskNames);
      if (mine.length)
        return {
          outcome: 'skipped',
          message: `${d.name} already has an open pull request: ${mine.map((p) => p.url).join(', ')}`,
        };
    }
  }

  const base = buildPrompt({ task, policy, rules: io.readFile('AGENTS.md') ?? '', signal });
  const prompt = opts.extraEvidence ? `${base.trimEnd()}\n\n${opts.extraEvidence.trim()}\n` : base;
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
      ? io.startBranch(opts.branch ?? branchName(d.name, policy.branchPrefix, opts.now))
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
  if (opts.requireTests) problems.push(...missingTests(changes));
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
  const shaped = closes
    ? { ...handoff, body: fitTemplate(handoff.body, io.readFile(PR_TEMPLATE)) }
    : handoff;
  const body = prBody({ task, harness, signal, gates, lines, handoff: shaped });
  const url = io.publish({
    branch,
    title: handoff.title,
    body: closes ? `Closes #${closes}\n\n${body}` : body,
  });
  io.restoreBranch();
  return { outcome: 'published', message: `draft pull request: ${url}`, branch };
}

// ── Live side effects ───────────────────────────────────────────────────────────────────────────

export function changesSince(root, base) {
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

/** `spawn` runs `gh` (injectable for tests); git runs directly. */
export function liveIo(root, { spawn = spawnSync } = {}) {
  let original = null;
  let base = null;
  const gh = (args, input) => spawn('gh', args, { cwd: root, encoding: 'utf8', input });
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
    /**
     * Puts the checkout on `branch` before a run, so the pull request's base is a branch name: in
     * Actions an `issue_comment` job may start on a detached commit.
     */
    useBranch: (branch) => {
      if (git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() !== branch)
        git(root, ['switch', branch]);
    },
    currentBranch: () => git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    exists: (path) => existsSync(join(root, path)),
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
    /**
     * Pushes, then updates the branch's open pull request, or opens a draft one. Looking first also
     * repairs a branch that was pushed before an earlier `gh pr create` failed (REQ-ISS-009).
     */
    publish: ({ branch, title, body }) => {
      git(root, ['push', '-u', 'origin', branch]);
      const found = gh([
        'pr',
        'list',
        '--head',
        branch,
        '--state',
        'open',
        '--json',
        'number,url',
        '--limit',
        '1',
      ]);
      const open = found.status === 0 ? JSON.parse(found.stdout || '[]')[0] : null;
      if (open) {
        const edit = gh(
          ['pr', 'edit', String(open.number), '--title', title, '--body-file', '-'],
          body
        );
        if (edit.status !== 0) throw new Error(`gh pr edit failed:\n${edit.stderr}`);
        return open.url;
      }
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
