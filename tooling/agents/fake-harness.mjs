#!/usr/bin/env node
/**
 * The `fake` harness (REQ-ISS-018, ADR-0037 D7): reads the prompt on stdin and answers with canned,
 * deterministic output for the task named on its first line, so the issue pipeline (labels,
 * comments, branch, pull request, verification) can be proved on GitHub Actions with no model and
 * no cost. Everything it produces says "fake harness".
 *
 * The task comes from the prompt's first line only (`# Agent task: <name>`), never from the
 * evidence below it, which may hold text anyone wrote on an issue.
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MARK = '_fake harness_: canned output, no model ran.';
const LEARNINGS = 'docs/LEARNINGS.md';

const today = () => process.env.AGENT_FAKE_DATE || new Date().toISOString().slice(0, 10);

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Adds one entry above the newest (the file is newest first), in the checked format. */
export function addLearning(markdown, date) {
  const entry = [
    `## ${date} - The fake harness ran the issue task`,
    '',
    '**Learning:** This entry was written by the fake harness to prove the issue pipeline end to end; no model ran.',
    '**Action:** Close the pull request that carries it, and delete this entry if it was merged by mistake.',
    '',
    '',
  ].join('\n');
  const at = markdown.search(/^## /m);
  return at === -1
    ? `${markdown.trimEnd()}\n\n${entry}`
    : markdown.slice(0, at) + entry + markdown.slice(at);
}

/** What the fake prints and writes for one task. Returns the stdout text. */
export function answer(name, prompt, root) {
  // The limits come before the task body and the evidence, so only the runner's text is read.
  const edit = /^- \*\*Mode: edit\.\*\*/m.test(prompt.split('\n## Task\n')[0]);
  switch (name) {
    case 'issue-gate':
      return [
        'VERDICT: ready',
        'SIZE: simple',
        '',
        '- Story: present (fake harness: not judged).',
        '- Acceptance criteria: present (fake harness: not judged).',
        '',
        'PLAN:',
        '',
        '- Goal: prove the issue pipeline with the fake harness.',
        `- Files: \`${LEARNINGS}\``,
        '- Requirement ids: none (a fake run changes no behaviour).',
        '- Tests to write first: none (documentation only).',
        '- Risks: none; close the pull request after checking it.',
        '- Estimated lines: 6',
        '',
        MARK,
        '',
      ].join('\n');
    case 'issue': {
      const learnings = join(root, LEARNINGS);
      writeFileSync(learnings, addLearning(readFileSync(learnings, 'utf8'), today()));
      write(
        root,
        '.agents/out/issue/result.md',
        [
          'docs(learnings): record a fake harness run',
          '',
          '**What** One entry in `docs/LEARNINGS.md`, written by the fake harness.',
          '',
          '**Why** To prove the trigger, branch, pull request and verification without a model.',
          '',
          '**Verification** None by the fake: the runner runs the gates after it.',
          '',
          '**Risk** None. Close this pull request; it is not a change anyone asked for.',
          '',
          MARK,
          '',
        ].join('\n')
      );
      return `fake harness: wrote ${LEARNINGS} and .agents/out/issue/result.md\n`;
    }
    case 'code-review':
      return `Looks good\n\n${MARK} A fake review is not a review.\n`;
    default:
      if (edit) {
        write(
          root,
          `.agents/out/${name}/result.md`,
          `NO-CHANGE: the fake harness makes no change for "${name}".\n\n${MARK}\n`
        );
        return `fake harness: no change for ${name}\n`;
      }
      return `${MARK} No report for "${name}".\n`;
  }
}

function main() {
  const prompt = readFileSync(0, 'utf8');
  const first = prompt.split('\n', 1)[0];
  const match = /^# Agent task: ([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/.exec(first);
  if (!match) {
    process.stderr.write(
      `fake harness: the first line must be "# Agent task: <name>", got "${first}"\n`
    );
    return 2;
  }
  process.stdout.write(answer(match[1], prompt, process.cwd()));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  process.exitCode = main();
