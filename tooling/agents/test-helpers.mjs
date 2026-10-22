// Shared fixtures for the tooling/agents tests (not itself a test file).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './agents.mjs';

export const ROOT = join(fileURLToPath(import.meta.url), '../../..');
export const POLICY = JSON.parse(readFileSync(join(ROOT, '.agents/policy.json'), 'utf8'));

export const EDIT = `---
name: spec-gap
summary: Turn one planned requirement into a test.
trigger: schedule
schedule: '17 5 * * 1'   # Mondays
signal: planned-requirements
mode: edit
deliverable: pr
scope: [docs/specs/, crates/]
gates: [pnpm test, cargo fmt --all -- --check]
max_changed_lines: 50
---

Pick one requirement.
`;
export const task = (text = EDIT, file = '.agents/tasks/spec-gap.md') => ({
  file,
  ...parseFrontmatter(text),
});
export const edited = (replace) =>
  task(Object.entries(replace).reduce((t, [from, to]) => t.replace(from, to), EDIT));
export const ctx = {
  exists: () => true,
  skills: new Set(['ios-production']),
  scripts: new Set(['test', 'metrics']),
};
export const REVIEW = task(
  `---
name: code-review
summary: Review the diff.
trigger: pull_request
signal: pr-diff
mode: read-only
deliverable: report
gates: []
---

Review it.
`,
  '.agents/tasks/code-review.md'
);

/** Records every side effect; each behaviour is set per test through `over`. */
export function fakeIo(over = {}) {
  const state = {
    clean: true,
    signal: { status: 1, output: 'REQ-X-2 [planned] Next' },
    openPrs: [],
    harness: { status: 0, output: 'done' },
    handoff: null,
    changes: [],
    gate: () => ({ status: 0, output: 'ok' }),
    statusBefore: '',
    statusAfter: '',
    ...over,
  };
  let harnessRan = false;
  const io = {
    files: { 'AGENTS.md': '# Rules' },
    logs: [],
    calls: {
      harness: 0,
      gates: [],
      commit: null,
      publish: null,
      comment: null,
      branch: [],
      discarded: null,
      restored: 0,
    },
    isClean: () => state.clean,
    status: () => (harnessRan ? state.statusAfter : state.statusBefore),
    runSignal: () => state.signal,
    openPrs: () => state.openPrs,
    readFile: (path) => (path.endsWith('result.md') ? state.handoff : (io.files[path] ?? null)),
    writeFile: (path, text) => {
      io.files[path] = text;
    },
    removeFile: (path) => delete io.files[path],
    startBranch: (branch) => {
      io.calls.branch.push(branch);
      return branch;
    },
    restoreBranch: () => io.calls.restored++,
    discardBranch: (branch) => (io.calls.discarded = branch),
    runHarness: (command, prompt) => {
      io.calls.harness++;
      io.calls.command = command;
      io.calls.prompt = prompt;
      harnessRan = true;
      return state.harness;
    },
    changes: () => state.changes,
    runGate: (command) => {
      io.calls.gates.push(command);
      return state.gate(command);
    },
    commit: (message) => (io.calls.commit = message),
    publish: (pr) => {
      io.calls.publish = pr;
      return 'https://github.com/o/r/pull/12';
    },
    comment: (number, body) => (io.calls.comment = { number, body }),
    log: (message) => io.logs.push(message),
  };
  return io;
}
export const OPTS = {
  harness: 'claude',
  policy: POLICY,
  now: new Date('2026-10-21T05:17:00Z'),
  taskNames: ['spec-gap', 'code-review'],
  harnessOptions: {},
};
