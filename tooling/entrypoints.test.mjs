// Every tooling script must run when started through a symlinked path. macOS temp folders
// (/var/folders → /private/var/folders) are symlinks, and a guard comparing import.meta.url with the
// unresolved argv[1] silently skipped main(), so checks run from scaffolded projects passed without
// running (docs/LEARNINGS.md, 2026-10-22).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const link = join(mkdtempSync(join(tmpdir(), 'tran-entry-')), 'tooling');
symlinkSync(join(ROOT, 'tooling'), link);
after(() => rmSync(join(link, '..'), { recursive: true, force: true }));

/** Each tool with arguments that only read the repo, and a line it prints only from main(). */
const TOOLS = [
  ['spec-check/spec-check.mjs', [], /spec-check: ok/],
  // A folder with no manifests: every platform is "no manifest", which passes.
  [
    'screens-check/screens-check.mjs',
    ['--dir', join(link, 'screens-check/none')],
    /screens-check: ok/,
  ],
  ['agents/agents.mjs', ['check'], /agents: \d+ tasks/],
  [
    'agents/agents.mjs',
    ['issue', '--event', join(link, 'agents/fixtures/events/issue-opened-weak.json'), '--dry-run'],
    /gate: needs-detail/,
  ],
  ['supply-chain/supply-chain.mjs', [], /supply-chain: actions pinned/],
  ['secrets/secrets.mjs', [], /secrets: ok/],
  ['mobile-release/mobile-release.mjs', ['check'], /mobile-release: ok/],
  ['todos/todos.mjs', [], /todos: ok \(\d+ test\(s\) switched off/],
  ['release/release.mjs', ['check'], /release: every version agrees/],
  ['contract/contract.mjs', [], /contract: /],
  // A fixed date: this checks the entry guard, and must not turn red the day a flag expires.
  ['flags/flags.mjs', ['--today', '2026-11-11'], /flags:check passed/],
];

describe('tooling entry points run through a symlinked path', () => {
  for (const [tool, args, printed] of TOOLS) {
    it([tool, ...args.map((arg) => basename(arg))].join(' '), () => {
      const out = execFileSync('node', [join(link, tool), ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.match(out, printed);
    });
  }
});

describe('no tool compares import.meta.url with an unresolved argv[1]', () => {
  it('every entry guard resolves the path first', () => {
    const tools = readdirSync(join(ROOT, 'tooling'), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.mjs') && !file.endsWith('.test.mjs'));
    const fragile = tools.filter((file) =>
      /pathToFileURL\(process\.argv\[1\]\)/.test(readFileSync(join(ROOT, 'tooling', file), 'utf8'))
    );
    assert.ok(tools.includes('metrics/metrics.mjs'));
    assert.deepEqual(fragile, []);
  });
});
