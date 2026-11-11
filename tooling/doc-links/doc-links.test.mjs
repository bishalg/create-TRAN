import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkFile, extractLinks, isExcluded, slugify } from './doc-links.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'doc-links-'));
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

describe('slugify (GitHub rules)', () => {
  it('lowercases, drops punctuation and turns spaces into hyphens', () => {
    assert.equal(slugify('Hello, World! (v2)'), 'hello-world-v2');
    assert.equal(slugify('7. Hardening backlog'), '7-hardening-backlog');
    assert.equal(slugify('`pnpm` tokens:sync'), 'pnpm-tokenssync');
  });
});

describe('extractLinks', () => {
  it('returns target and 1-based line for inline links', () => {
    const links = extractLinks('# T\n\nSee [a](./a.md) and [b](b.md#x "title").\n');
    assert.deepEqual(links, [
      { target: './a.md', line: 3 },
      { target: 'b.md#x', line: 3 },
    ]);
  });

  it('ignores links inside fenced code blocks', () => {
    assert.deepEqual(extractLinks('```md\n[a](./nope.md)\n```\n[b](ok.md)\n'), [
      { target: 'ok.md', line: 4 },
    ]);
    assert.deepEqual(extractLinks('~~~\n[a](./nope.md)\n~~~\n'), []);
  });

  it('ignores inline code spans', () => {
    assert.deepEqual(extractLinks('Use `[a](./nope.md)` here\n'), []);
  });
});

describe('isExcluded', () => {
  it('skips dependencies, build output, generated output and the changelog', () => {
    assert.equal(isExcluded('node_modules/x/README.md'), true);
    assert.equal(isExcluded('apps/web/node_modules/x/README.md'), true);
    assert.equal(isExcluded('target/doc/x.md'), true);
    assert.equal(isExcluded('CHANGELOG.md'), true);
    assert.equal(isExcluded('docs/README.md'), false);
  });
});

describe('checkFile', () => {
  it('passes for existing files, directories, and matching fragments', () => {
    const root = project({
      'docs/a.md': '[b](./b.md) [dir](../docs) [frag](./b.md#hello-world) [self](#top)\n\n# Top\n',
      'docs/b.md': '# Hello, World\n',
    });
    assert.deepEqual(checkFile(root, 'docs/a.md'), []);
  });

  it('reports a missing target with file and line', () => {
    const root = project({ 'a.md': 'x\n[gone](./gone.md)\n' });
    assert.deepEqual(checkFile(root, 'a.md'), [{ file: 'a.md', line: 2, target: './gone.md' }]);
  });

  it('reports a fragment that matches no heading, in this or another file', () => {
    const root = project({ 'a.md': '[x](b.md#nope) [y](#missing)\n', 'b.md': '# Real\n' });
    assert.deepEqual(
      checkFile(root, 'a.md').map((f) => f.target),
      ['b.md#nope', '#missing']
    );
  });

  it('numbers duplicate headings like GitHub (-1, -2)', () => {
    const root = project({ 'a.md': '[x](#dup-1)\n\n# Dup\n\n# Dup\n' });
    assert.deepEqual(checkFile(root, 'a.md'), []);
  });

  it('skips external links, mailto, and absolute-URL schemes', () => {
    const root = project({
      'a.md': '[x](https://example.com/n.md) [y](mailto:a@b.c) [z](http://x.y)\n',
    });
    assert.deepEqual(checkFile(root, 'a.md'), []);
  });

  it('decodes percent-escapes and ignores a query string', () => {
    const root = project({ 'a.md': '[x](my%20file.md)\n', 'my file.md': '# T\n' });
    assert.deepEqual(checkFile(root, 'a.md'), []);
  });
});
