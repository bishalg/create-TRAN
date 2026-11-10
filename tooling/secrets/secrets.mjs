#!/usr/bin/env node
/**
 * `pnpm secrets:check` (spec 022, REQ-SEC-001..003, ADR-0039): keeps secrets out of git and out of clients.
 *
 * - scan: every tracked file (or, with `--staged`, the staged content) for private-key blocks and
 *   high-confidence provider token shapes; findings never print the matched value
 * - env contract: the variables the application code reads and the keys of `.env.example` agree both ways
 * - client names: `VITE_*`, Android `buildConfigField` and custom iOS Info.plist keys carry no secret-like name
 *
 * Zero dependencies (ADR-0016): it runs in the pre-commit hook before `pnpm install` is trusted.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Rules are deliberately strict: a false positive trains people to bypass the check. */
export const RULES = [
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'github-token', pattern: /\bgh[pos]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  { name: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  {
    name: 'openai-key',
    pattern:
      /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/,
  },
  { name: 'stripe-key', pattern: /\b[sr]k_live_[0-9A-Za-z]{24,}/ },
  { name: 'slack-token', pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}/ },
];

const LOCKFILE =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|Package\.resolved|gradle\.lockfile)$/;

/** Lockfiles carry integrity hashes, not secrets. */
export function isLockfile(path) {
  return LOCKFILE.test(path);
}

/** A NUL byte in the first 8 KB is how git itself guesses "binary". */
export function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

/** First four characters and the length: enough to find it, not enough to use it. */
export function redact(value) {
  return `${value.slice(0, 4)}…[${value.length} chars]`;
}

/** Findings of one file's text: `{ file, line, rule, redacted }`. */
export function scanText(file, text) {
  const findings = [];
  text.split('\n').forEach((content, index) => {
    for (const { name, pattern } of RULES) {
      const match = pattern.exec(content);
      if (match) findings.push({ file, line: index + 1, rule: name, redacted: redact(match[0]) });
    }
  });
  return findings;
}

/** Signing material is never tracked, whatever its content (REQ-MOB-005); `.gitignore` lists the same. */
export const SIGNING_FILE = /\.(p8|p12|mobileprovision|jks|keystore)$/i;

/** Where a literal Apple team id or App Store Connect key id must never be assigned (REQ-MOB-005). */
const APPLE_ID_FILE = /(^|\/)fastlane\/(Fastfile|Appfile)$|^apps\/ios\/project\.yml$/;
const APPLE_ID_ASSIGNMENT =
  /\b(?:team_id|itc_team_id|export_team_id|dev_portal_team_id|key_id|DEVELOPMENT_TEAM|teamID)\b["']?(?:\s*[:=,(]\s*|\s+)+["']?([A-Z0-9]{10})\b/;

/** Findings that depend on the kind of file: service-account keys, literal Apple ids. */
export function scanByPath(file, text) {
  const findings = [];
  text.split('\n').forEach((content, index) => {
    const add = (rule, value) =>
      findings.push({ file, line: index + 1, rule, redacted: redact(value) });
    if (file.endsWith('.json')) {
      const key = /"type"\s*:\s*"service_account"/.exec(content);
      if (key) add('google-service-account', key[0]);
    }
    if (APPLE_ID_FILE.test(file)) {
      const id = APPLE_ID_ASSIGNMENT.exec(content);
      if (id && /\d/.test(id[1]) && /[A-Z]/.test(id[1])) add('apple-identifier', id[1]);
    }
  });
  return findings;
}

/** Scan `{ path: Buffer }`: signing files by name, then text, skipping binaries and lockfiles. */
export function scanFiles(files) {
  return Object.entries(files).flatMap(([path, buffer]) => {
    if (SIGNING_FILE.test(path))
      return [{ file: path, line: 1, rule: 'signing-file', redacted: '(file not read)' }];
    if (isLockfile(path) || isBinary(buffer)) return [];
    const text = buffer.toString('utf8');
    return [...scanText(path, text), ...scanByPath(path, text)];
  });
}

/**
 * Remove allowlisted findings. Problems: an entry without a reason, and (unless `partial`, as with
 * `--staged`, which sees only some files) an entry that matched nothing.
 */
export function applyAllowlist(findings, allow, { partial = false } = {}) {
  const problems = [];
  const used = new Set();
  const remaining = findings.filter((finding) => {
    const index = allow.findIndex((e) => e.file === finding.file && e.rule === finding.rule);
    if (index < 0) return true;
    used.add(index);
    return false;
  });
  allow.forEach((entry, index) => {
    const name = `allow.json entry ${entry.file} / ${entry.rule}`;
    if (typeof entry.reason !== 'string' || !entry.reason.trim())
      problems.push(`${name} has no reason`);
    if (!partial && !used.has(index)) problems.push(`${name} matches nothing any more; remove it`);
  });
  return { findings: remaining, problems };
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=/;

/**
 * Keys of an `.env.example`. `# HOST=0.0.0.0` is an alternative value, not a key. Each key needs a comment
 * line above it in its section (the lines between blank lines).
 */
export function exampleKeys(text) {
  const keys = [];
  const problems = [];
  let commented = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) commented = false;
    else if (line.startsWith('#')) commented = true;
    else {
      const match = KEY_LINE.exec(line);
      if (!match) continue;
      keys.push(match[1]);
      if (!commented) problems.push(`.env.example: ${match[1]} has no comment above it`);
    }
  }
  return { keys, problems };
}

/**
 * Variables read by libraries, not by repo code. `RUST_LOG` is read by `EnvFilter::try_from_default_env()`
 * in `tracing-subscriber` (apps/api/src/main.rs), so no literal read exists to find.
 */
export const READ_BY_DEPENDENCY = ['RUST_LOG'];

/**
 * Names read by application code, from `{ path: text }`. The boundary: `apps/api/src` (Rust config
 * lookup), `apps/web/src` and `packages/*\/src` (`import.meta.env.VITE_*`, or `env.VITE_*` on the object a function receives from it), and `process.env.*` in
 * `apps/web/src`; the release configuration of the native apps (REQ-MOB-004): fastlane's Fastfiles and
 * Appfiles (`ENV["X"]`, `ENV.fetch("X")`) and Android Gradle scripts (`System.getenv("X")`,
 * `providers.environmentVariable("X")`). Tooling, CI scripts and the `create-tran` generator CLI (its
 * `process.env` is the developer's shell, not deployment configuration) are not application configuration.
 */
export function codeEnvNames(files) {
  const names = new Set();
  for (const [path, text] of Object.entries(files)) {
    if (/\.test\.|\.spec\.|\/tests?\//.test(path)) continue;
    if (path.startsWith('apps/api/src/') && path.endsWith('.rs'))
      for (const m of text.matchAll(/\b(?:lookup|env::var)\(\s*"([A-Z][A-Z0-9_]*)"/g))
        names.add(m[1]);
    if (/^(apps\/web|packages\/[^/]+)\/src\//.test(path))
      for (const m of text.matchAll(/\benv\.(VITE_[A-Z0-9_]+)/g)) names.add(m[1]);
    if (path.startsWith('apps/web/src/'))
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
    if (/^apps\/(ios|android)\/fastlane\/(Fastfile|Appfile)$/.test(path))
      for (const m of text.matchAll(/\bENV(?:\[|\.fetch\()\s*["']([A-Z][A-Z0-9_]*)["']/g))
        names.add(m[1]);
    if (/^apps\/android\/.*\.gradle\.kts$/.test(path))
      for (const m of text.matchAll(
        /\b(?:System\.getenv|providers\.environmentVariable)\(\s*"([A-Z][A-Z0-9_]*)"/g
      ))
        names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * Variables only a switched-off test reads (a real device's token for a live push test), from the
 * `TODO(credentials): <VARIABLES> - …` markers in `{ path: text }` (REQ-CODE-005, `pnpm todos:check`).
 */
export function credentialTestNames(files) {
  const names = new Set();
  for (const text of Object.values(files))
    for (const m of text.matchAll(
      /TODO\(credentials\):\s*([A-Z][A-Z0-9_]*(?:\s*,\s*[A-Z][A-Z0-9_]*)*)\s+-/g
    ))
      for (const name of m[1].split(',')) names.add(name.trim());
  return [...names].sort();
}

/** Both directions: read but not listed, listed but not read (by code, or by a switched-off test). */
export function compareEnv(codeNames, keys, testNames = []) {
  const problems = [];
  for (const name of codeNames)
    if (!keys.includes(name))
      problems.push(`${name} is read by code but missing from .env.example`);
  for (const key of keys)
    if (!codeNames.includes(key) && !READ_BY_DEPENDENCY.includes(key) && !testNames.includes(key))
      problems.push(`${key} is in .env.example but no code reads it`);
  return problems;
}

const SECRET_LIKE = /SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|API_?KEY/i;
const APPLE_STANDARD = /^(CF|NS|UI|LS)/;

/**
 * Client-visible names that match SECRET_LIKE but hold public identifiers. Firebase's Android "API key"
 * names the project to Google and ships in every Firebase app by design; it grants nothing (ADR-0044).
 */
export const PUBLIC_BY_DESIGN = ['TRAN_FCM_API_KEY'];

/** Secret-like names among client-visible ones, `[{ source, name }]`. */
export function secretLikeNames(names) {
  return names.filter(({ name }) => SECRET_LIKE.test(name) && !PUBLIC_BY_DESIGN.includes(name));
}

/** Names of every kind of client-visible variable, from `{ path: text }`. */
export function clientNames(files, codeNames, keys) {
  const names = [...new Set([...codeNames, ...keys])]
    .filter((name) => name.startsWith('VITE_'))
    .map((name) => ({ source: 'VITE variable', name }));
  for (const [path, text] of Object.entries(files)) {
    if (/^apps\/android\/.*\.gradle\.kts$/.test(path))
      for (const m of text.matchAll(/buildConfigField\(\s*"[^"]*"\s*,\s*"([^"]+)"/g))
        names.push({ source: `${path} buildConfigField`, name: m[1] });
    if (path === 'apps/ios/Support/Info.plist')
      for (const m of text.matchAll(/<key>([^<]+)<\/key>/g))
        if (!APPLE_STANDARD.test(m[1])) names.push({ source: `${path} key`, name: m[1] });
    if (path === 'apps/ios/project.yml') names.push(...ymlInfoProperties(text, path));
  }
  return names;
}

/** Custom keys under `info: … properties:` of project.yml; a tiny indentation parser. */
export function ymlInfoProperties(yaml, path = 'apps/ios/project.yml') {
  const names = [];
  const lines = yaml.split('\n');
  const indentOf = (line) => line.length - line.trimStart().length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'properties:') continue;
    const base = indentOf(lines[i]);
    const keyIndent = i + 1 < lines.length ? indentOf(lines[i + 1]) : 0;
    for (let j = i + 1; j < lines.length && (!lines[j].trim() || indentOf(lines[j]) > base); j++) {
      const m = /^\s*([A-Za-z0-9_.-]+):/.exec(lines[j]);
      if (m && indentOf(lines[j]) === keyIndent && !APPLE_STANDARD.test(m[1]))
        names.push({ source: `${path} info.properties`, name: m[1] });
    }
  }
  return names;
}

const git = (...args) => execFileSync('git', args, { maxBuffer: 1 << 28 });
const lines = (buffer) => buffer.toString('utf8').split('\n').filter(Boolean);

function readTracked(staged) {
  const paths = staged
    ? lines(git('diff', '--cached', '--name-only', '--diff-filter=ACM'))
    : lines(git('ls-files')).filter((p) => existsSync(p));
  return Object.fromEntries(paths.map((p) => [p, staged ? git('show', `:${p}`) : readFileSync(p)]));
}

function main(argv) {
  const staged = argv.includes('--staged');
  const files = readTracked(staged);
  const allow = JSON.parse(readFileSync(new URL('./allow.json', import.meta.url), 'utf8'));
  const scanned = applyAllowlist(scanFiles(files), allow, { partial: staged });
  const problems = scanned.problems;
  for (const f of scanned.findings)
    problems.push(
      `${f.file}:${f.line} ${f.rule} (${f.redacted}); remove it, or allow it in tooling/secrets/allow.json with a reason`
    );
  if (!staged) {
    const text = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
    const example = exampleKeys(text('.env.example'));
    const code = codeEnvNames(
      Object.fromEntries(Object.entries(files).map(([p, b]) => [p, b.toString('utf8')]))
    );
    const textFiles = Object.fromEntries(
      Object.entries(files).map(([p, b]) => [p, b.toString('utf8')])
    );
    problems.push(
      ...example.problems,
      ...compareEnv(code, example.keys, credentialTestNames(textFiles))
    );
    for (const { source, name } of secretLikeNames(clientNames(textFiles, code, example.keys)))
      problems.push(`${source}: ${name} is compiled into a client and looks like a secret`);
  }
  if (problems.length) {
    console.error(
      `secrets: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`
    );
    process.exit(1);
  }
  console.log(
    `secrets: ok (${Object.keys(files).length} files scanned${staged ? ', staged only' : ', env contract and client names checked'})`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main(process.argv.slice(2));
