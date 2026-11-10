#!/usr/bin/env node
/**
 * `pnpm todos:check` (spec 019, REQ-CODE-005, ADR-0046): no test is switched off without saying why.
 *
 * - finds every skipped, ignored or disabled test in the tracked files, in each test dialect the repo uses
 *   (`DIALECTS`): Rust, vitest / node:test / Playwright, XCTest and Xcode schemes, JUnit, Gherkin, Maestro
 * - each needs the marker `TODO(credentials): <VARIABLES> - <what it proves>` in its reason, or in the comment
 *   directly above it, or an entry in `tooling/todos/allow.json` (`{ file, count, reason }`) for a skip that
 *   depends on the machine (a toolchain, an emulator, an entitlement), never on a credential
 * - every variable a marker names is listed in `.env.example` and in a row of `docs/CREDENTIALS.md`; every row
 *   there is backed by a marker or, for a store upload, by its platform's `doctor` lane (`mobile-release.mjs`)
 *
 * `--list` prints every credential-gated test as a table. Green always says how many tests are off.
 * Zero dependencies, like the other checks; `tooling/todos/` itself is not scanned (its test holds samples).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { REQUIRED } from '../mobile-release/mobile-release.mjs';
import { exampleKeys } from '../secrets/secrets.mjs';

const NAME = '[A-Z][A-Z0-9_]*';

/** `TODO(credentials): A, B - what it proves`, ending at a quote, a `*\/` or the end of the line. */
export const MARKER = new RegExp(
  `TODO\\(credentials\\):\\s*(${NAME}(?:\\s*,\\s*${NAME})*)\\s+-\\s+(.+?)\\s*(?:["'\`]|\\*/|$)`,
  'm'
);

/** The marker in `text`: `{ variables, proves }`, `null` without one, `{ malformed: true }` when it is broken. */
export function parseMarker(text) {
  if (!text.includes('TODO(credentials)')) return null;
  const match = MARKER.exec(text);
  if (!match || !match[2].trim()) return { malformed: true };
  return { variables: match[1].split(',').map((v) => v.trim()), proves: match[2].trim() };
}

const SLASH_COMMENT = /^\s*(\/\/|\/\*|\*)/;
const HASH_COMMENT = /^\s*#/;

/**
 * One entry per way a test is switched off. `files` picks the files of a dialect; `comment` is how its
 * comment lines start (a match there is prose, and a comment block above a skip may carry its marker).
 */
export const DIALECTS = [
  {
    name: 'rust',
    files: /\.rs$/,
    comment: SLASH_COMMENT,
    patterns: [/#\[ignore\b/],
  },
  {
    name: 'js',
    files: /\.(test|spec)\.[cm]?[jt]sx?$|^e2e\/.*\.[cm]?[jt]s$/,
    comment: SLASH_COMMENT,
    patterns: [
      /\b(?:it|test|describe|suite|bench)\.(?:skip|todo|fixme|skipIf|runIf)\b/,
      /\b(?:xit|xtest|xdescribe)\(/,
      /\bt\.(?:skip|todo)\(/,
      // node:test options (`{ skip: true }`, `{ todo: 'why' }`), not a parameter typed `skip: RegExp`.
      /[{,]\s*(?:skip|todo)\s*:\s*(?:true\b|!|['"`]|process\.)/,
    ],
  },
  {
    name: 'swift',
    files: /^apps\/ios\/Tests\/.*\.swift$/,
    comment: SLASH_COMMENT,
    // XCTest skips, and Swift Testing's `.disabled` trait (SwiftUI's `.disabled(_:)` is not in Tests/).
    patterns: [/\bXCTSkip(?:If|Unless)?\b/, /@(?:Test|Suite)\b.*\.disabled\b/],
  },
  {
    name: 'xcode',
    files: /\.(xcscheme|xctestplan)$|^apps\/ios\/project\.yml$/,
    comment: HASH_COMMENT,
    patterns: [/skipped\s*=\s*"YES"/, /<SkippedTests>/, /"skippedTests"|\bskippedTests\s*:/, /"enabled"\s*:\s*false/],
  },
  {
    name: 'junit',
    files: /\.(kt|java)$/,
    comment: SLASH_COMMENT,
    patterns: [
      /@(?:Ignore|Disabled)\b/,
      /\bAssume\.assume\w*\(|\bassume(?:True|False|NotNull|NoException|That)\(/,
    ],
  },
  {
    name: 'gherkin',
    files: /\.feature$/,
    comment: HASH_COMMENT,
    // playwright-bdd turns these tags into test.skip / test.fixme.
    patterns: [/(^|\s)@(?:skip|fixme)\b/],
  },
  {
    name: 'maestro',
    files: /^e2e\/maestro\/.*\.ya?ml$/,
    comment: HASH_COMMENT,
    patterns: [/^\s*excludeTags\s*:/],
  },
];

const SELF = /^tooling\/todos\//;

/** The comment block directly above line `index`, and the statement from it until its brackets close. */
function context(lines, index, comment) {
  let start = index;
  while (start > 0 && comment.test(lines[start - 1])) start--;
  let end = index;
  let depth = 0;
  for (; end < lines.length && end < index + 8; end++) {
    for (const ch of lines[end]) depth += ch === '(' || ch === '[' ? 1 : ch === ')' || ch === ']' ? -1 : 0;
    if (depth <= 0) break;
  }
  return lines.slice(start, end + 1).join('\n');
}

/** Every switched-off test in one file: `{ file, line, dialect, marker }` (`marker` from `parseMarker`). */
export function findSkips(file, text) {
  if (SELF.test(file)) return [];
  const dialect = DIALECTS.find((d) => d.files.test(file));
  if (!dialect) return [];
  const lines = text.split('\n');
  const skips = [];
  lines.forEach((content, index) => {
    if (dialect.comment.test(content)) return;
    if (!dialect.patterns.some((pattern) => pattern.test(content))) return;
    const marker = parseMarker(context(lines, index, dialect.comment));
    skips.push({ file, line: index + 1, dialect: dialect.name, marker });
  });
  return skips;
}

/**
 * Splits skips into credential-gated tests and problems. A skip without a marker must be covered by an
 * allowlist entry for its file whose `count` is exactly the number of unmarked skips there; an entry without a
 * reason, or with a count that no longer matches, is a problem too (like `tooling/secrets/allow.json`).
 */
export function classify(skips, allow) {
  const gated = [];
  const problems = [];
  const unmarked = new Map();
  for (const skip of skips) {
    const where = `${skip.file}:${skip.line}`;
    if (skip.marker?.malformed)
      problems.push(`${where}: malformed marker; write TODO(credentials): <VARIABLES> - <what it proves>`);
    else if (skip.marker) gated.push({ ...skip.marker, file: skip.file, line: skip.line });
    else unmarked.set(skip.file, [...(unmarked.get(skip.file) ?? []), skip]);
  }
  const allowed = new Set();
  for (const entry of allow) {
    const name = `tooling/todos/allow.json entry ${entry.file}`;
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) problems.push(`${name} has no reason`);
    const found = unmarked.get(entry.file)?.length ?? 0;
    if (found === 0) problems.push(`${name} matches nothing any more; remove it`);
    else if (found !== entry.count)
      problems.push(`${name} allows ${entry.count} skip(s) but the file has ${found}; review them`);
    allowed.add(entry.file);
  }
  for (const [file, list] of unmarked)
    if (!allowed.has(file))
      for (const skip of list)
        problems.push(
          `${file}:${skip.line}: a ${skip.dialect} test is switched off without TODO(credentials): <VARIABLES> - <what it proves>, and no allowlist entry`
        );
  return { gated, problems };
}

/** The rows of the first table in `docs/CREDENTIALS.md`: `{ feature, variables, gate }`, by its header names. */
export function credentialRows(markdown) {
  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  const all = markdown.split('\n');
  const first = all.findIndex((l) => l.trim().startsWith('|'));
  const after = first < 0 ? [] : all.slice(first);
  const stop = after.findIndex((l) => !l.trim().startsWith('|'));
  const lines = stop < 0 ? after : after.slice(0, stop);
  const header = lines.length ? cells(lines[0]) : [];
  const column = (name) => header.findIndex((h) => h.toLowerCase() === name);
  const [feature, variables, gate] = ['feature', 'variables', 'gate'].map(column);
  return lines.slice(2).map((line) => {
    const row = cells(line);
    return {
      feature: row[feature] ?? '',
      variables: [...(row[variables] ?? '').matchAll(new RegExp(`\`(${NAME})\``, 'g'))].map((m) => m[1]),
      gate: gate < 0 ? '' : (row[gate] ?? ''),
    };
  });
}

const DOCTOR = /pnpm (ios|android):lane doctor/;

/**
 * The marker's variables are documented in both places, and each row is backed: by a marker naming one of its
 * variables (gate "skipped tests"), or by the doctor lane of its platform, which must check every variable.
 */
export function checkCredentials(gated, envKeys, rows, required = REQUIRED) {
  const problems = [];
  const inRows = new Set(rows.flatMap((r) => r.variables));
  const named = new Set(gated.flatMap((g) => g.variables));
  for (const name of [...named].sort()) {
    if (!envKeys.includes(name)) problems.push(`${name} is named by a TODO(credentials) marker but missing from .env.example`);
    if (!inRows.has(name)) problems.push(`${name} is named by a TODO(credentials) marker but in no row of docs/CREDENTIALS.md`);
  }
  for (const row of rows) {
    const doctor = DOCTOR.exec(row.gate);
    if (doctor) {
      const checked = required[doctor[1]] ?? [];
      for (const name of row.variables.filter((v) => !checked.includes(v)))
        problems.push(`docs/CREDENTIALS.md "${row.feature}": ${name} is not checked by pnpm ${doctor[1]}:lane doctor`);
    } else if (/skipped test/i.test(row.gate)) {
      if (!row.variables.some((v) => named.has(v)))
        problems.push(`docs/CREDENTIALS.md "${row.feature}": no TODO(credentials) marker names its variables`);
    } else
      problems.push(
        `docs/CREDENTIALS.md "${row.feature}": its Gate must name the skipped tests or a pnpm <platform>:lane doctor`
      );
  }
  return problems;
}

/** The `--list` table, sorted by file. */
export function table(gated) {
  const rows = [...gated].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return [
    '| Test | Variables | What it proves |',
    '| :--- | :--- | :--- |',
    ...rows.map((g) => `| \`${g.file}:${g.line}\` | ${g.variables.map((v) => `\`${v}\``).join(', ')} | ${g.proves} |`),
  ].join('\n');
}

/** The green line: never "ok" alone, always how many tests are off and why. */
export function summary(gated, allow) {
  const machine = allow.reduce((n, e) => n + (e.count ?? 0), 0);
  return `todos: ok (${gated.length} test(s) switched off until credentials are set, ${machine} skipped for a reason in tooling/todos/allow.json, such as a missing device; --list shows the first kind)`;
}

function main(argv) {
  const git = (...args) => execFileSync('git', args, { maxBuffer: 1 << 28 }).toString('utf8');
  // Tracked and new (not ignored) files: a skip must be explained before it is committed.
  const tracked = git('ls-files', '--cached', '--others', '--exclude-standard')
    .split('\n')
    .filter((p) => p && existsSync(p));
  const skips = tracked.flatMap((path) => findSkips(path, readFileSync(path, 'utf8')));
  const allow = JSON.parse(readFileSync(new URL('./allow.json', import.meta.url), 'utf8'));
  const { gated, problems } = classify(skips, allow);
  const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  problems.push(
    ...checkCredentials(gated, exampleKeys(read('.env.example')).keys, credentialRows(read('docs/CREDENTIALS.md')))
  );
  if (argv.includes('--list')) console.log(`${table(gated)}\n`);
  if (problems.length) {
    console.error(`todos: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(summary(gated, allow));
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main(process.argv.slice(2));
