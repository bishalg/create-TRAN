#!/usr/bin/env node
/**
 * Docs link check: every relative link in a tracked Markdown file must point at something that exists,
 * and a `#fragment` into a Markdown file must match a heading there (GitHub slug rules).
 * External links (http, https, mailto, any `scheme:`) are skipped, as are links inside fenced code.
 *
 * Output per failure:  file:line  broken link → target
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXCLUDED_DIRS = new Set(['node_modules', 'target', 'dist', 'build', 'coverage', 'reports']);
const EXCLUDED_FILES = new Set(['CHANGELOG.md']);
const LINK = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const FENCE = /^\s*(```|~~~)/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function isExcluded(path) {
  const parts = path.split('/');
  return (
    EXCLUDED_FILES.has(parts[parts.length - 1]) ||
    parts.slice(0, -1).some((p) => EXCLUDED_DIRS.has(p))
  );
}

/** GitHub heading slug: lowercase, drop punctuation (keep letters, digits, `-`, `_`), spaces to hyphens. */
export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export function extractLinks(markdown) {
  const links = [];
  let fence = null;
  markdown.split('\n').forEach((raw, i) => {
    const marker = FENCE.exec(raw)?.[1];
    if (marker) {
      fence = fence === null ? marker : fence === marker ? null : fence;
      return;
    }
    if (fence !== null) return;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const m of line.matchAll(LINK)) links.push({ target: m[1], line: i + 1 });
  });
  return links;
}

function headingSlugs(markdown) {
  const seen = new Map();
  const slugs = new Set();
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) fence = !fence;
    const m = !fence && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_]/g, (c) => (c === '_' ? c : ''));
    const base = slugify(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function checkFile(root, file) {
  const failures = [];
  const text = readFileSync(join(root, file), 'utf8');
  for (const { target, line } of extractLinks(text)) {
    if (SCHEME.test(target)) continue;
    const [pathPart, ...rest] = target.split('#');
    const fragment = rest.join('#');
    const clean = decode(pathPart.split('?')[0]);
    const abs = clean === '' ? join(root, file) : resolve(root, dirname(file), clean);
    let ok = existsSync(abs);
    if (ok && fragment && abs.endsWith('.md') && statSync(abs).isFile()) {
      const source = clean === '' ? text : readFileSync(abs, 'utf8');
      ok = headingSlugs(source).has(decode(fragment).toLowerCase());
    }
    if (!ok) failures.push({ file, line, target });
  }
  return failures;
}

function trackedMarkdown(root) {
  return execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && !isExcluded(f) && existsSync(join(root, f)));
}

function main(root) {
  const files = trackedMarkdown(root);
  const failures = files.flatMap((f) => checkFile(root, f));
  for (const f of failures) console.error(`${f.file}:${f.line}  broken link → ${f.target}`);
  if (failures.length > 0) {
    console.error(`doc-links: ${failures.length} broken link(s) in ${files.length} files`);
    process.exit(1);
  }
  console.log(`doc-links: ${files.length} markdown files, ok`);
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main(process.cwd());
