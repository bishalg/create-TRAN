// Every tooling script must run when started through a symlinked path. macOS temp folders
// (/var/folders → /private/var/folders) are symlinks, and a guard comparing import.meta.url with the
// unresolved argv[1] silently skipped main(), so checks run from scaffolded projects passed without
// running (docs/LEARNINGS.md, 2026-10-22).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const link = join(mkdtempSync(join(tmpdir(), 'tran-entry-')), 'tooling');
symlinkSync(join(ROOT, 'tooling'), link);
after(() => rmSync(join(link, '..'), { recursive: true, force: true }));

/** Each tool with arguments that only read the repo, and a line it prints only from main(). */
const TOOLS = [
  ['spec-check/spec-check.mjs', [], /spec-check: ok/],
  ['agents/agents.mjs', ['check'], /agents: \d+ tasks/],
  ['supply-chain/supply-chain.mjs', [], /supply-chain: actions pinned/],
  ['release/release.mjs', ['check'], /release: every version agrees/],
];

describe('tooling entry points run through a symlinked path', () => {
  for (const [tool, args, printed] of TOOLS) {
    it(tool, () => {
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
