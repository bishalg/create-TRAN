/** Signals (REQ-AGT-003): the evidence that decides whether an agent starts, and the built-ins. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRequirements } from '../spec-check/spec-check.mjs';
import { defaultBranch, readJson, sh } from './shell.mjs';

/** Keeps the first `maxLines` lines and says how many were cut. */
export function truncate(text, maxLines) {
  const lines = text.replace(/\s+$/, '').split('\n');
  if (lines.length <= maxLines) return lines.join('\n');
  return [
    ...lines.slice(0, maxLines),
    `… ${lines.length - maxLines} more lines cut (raise "evidence_lines" to see them)`,
  ].join('\n');
}

/** Exit 0: nothing to do. 126/127 or killed: the signal itself is broken. Anything else: work. */
export function evaluateSignal({ status, output }, maxLines) {
  const evidence = truncate(output ?? '', maxLines);
  if (status === 0) return { kind: 'none', status, evidence };
  if (status === null || status === 126 || status === 127)
    return { kind: 'broken', status, evidence };
  return { kind: 'work', status, evidence };
}

export function plannedRequirements(requirements) {
  const planned = requirements.filter((r) => r.status === 'planned');
  return planned.length
    ? {
        status: 1,
        output: planned.map((r) => `${r.id} [planned] ${r.title} (${r.file})`).join('\n'),
      }
    : { status: 0, output: 'no [planned] requirements' };
}

const flatten = (object, prefix = '') =>
  Object.entries(object).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]]
  );

/** `dictionaries`: { en: { 'common.title': 'Vote' }, ne: { … } }. English is the base (ADR-0020). */
export function untranslatedStrings(dictionaries, allow = []) {
  const english = dictionaries.en ?? {};
  const found = Object.keys(dictionaries)
    .filter((locale) => locale !== 'en')
    .sort()
    .flatMap((locale) =>
      Object.entries(dictionaries[locale])
        .filter(([key, value]) => value === english[key] && !allow.includes(key))
        .map(([key, value]) => `${locale} ${key}: ${JSON.stringify(value)}`)
    );
  return found.length
    ? { status: 1, output: found.join('\n') }
    : { status: 0, output: 'every string is translated' };
}

/**
 * cargo-mutants' `missed.txt` (paths from the workspace root) and Stryker's JSON report (paths from
 * its package, `strykerRoot`), either of which may be absent.
 */
export function survivingMutants({ cargoMissed, strykerJson, strykerRoot = '' }) {
  const lines = (cargoMissed ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => `rust: ${line}`);
  for (const [file, { mutants = [] }] of Object.entries(strykerJson?.files ?? {}))
    for (const m of mutants.filter((mutant) => mutant.status === 'Survived'))
      lines.push(
        `ts: ${strykerRoot}${file}:${m.location.start.line}: ${m.mutatorName} → ${JSON.stringify(m.replacement ?? '')}`
      );
  if (lines.length) return { status: 1, output: lines.join('\n') };
  const none = cargoMissed === undefined && strykerJson === undefined;
  return {
    status: 0,
    output: none
      ? 'no mutation report: run `cargo mutants` or `pnpm --filter @tran/core mutation` first'
      : 'no surviving mutants',
  };
}

/** Built-in signals: each returns { status, output }, exit-code style. */
export const SIGNALS = {
  'planned-requirements': (root) => {
    const dir = join(root, 'docs/specs');
    const files = readdirSync(dir).filter((file) => /^\d{3}-.+\.md$/.test(file));
    return plannedRequirements(
      files.flatMap((file) =>
        parseRequirements(readFileSync(join(dir, file), 'utf8'), `docs/specs/${file}`)
      )
    );
  },
  'untranslated-strings': (root, policy) => {
    const dir = join(root, 'locales');
    const dictionaries = {};
    for (const locale of readdirSync(dir).filter((name) => !name.startsWith('.')))
      dictionaries[locale] = Object.fromEntries(
        readdirSync(join(dir, locale))
          .filter((file) => file.endsWith('.json'))
          .flatMap((file) =>
            flatten(readJson(join(dir, locale, file)), `${file.replace(/\.json$/, '')}.`)
          )
      );
    return untranslatedStrings(dictionaries, policy.signals?.['untranslated-strings']?.allow);
  },
  'mutants-missed': (root) => {
    const missed = join(root, 'mutants.out/missed.txt');
    return survivingMutants({
      cargoMissed: existsSync(missed) ? readFileSync(missed, 'utf8') : undefined,
      strykerJson: readJson(join(root, 'packages/core-ts/reports/mutation/mutation.json')),
      strykerRoot: 'packages/core-ts/',
    });
  },
  /** The change under review: AGENT_BASE (CI sets the pull request base), else the default branch. */
  'pr-diff': (root) => {
    const base = process.env.AGENT_BASE || defaultBranch(root);
    const diff = sh(
      root,
      `git diff --no-color --stat ${base}...HEAD && git diff --no-color ${base}...HEAD`
    );
    if (diff.status !== 0) return { status: 127, output: diff.output };
    return diff.output.trim()
      ? { status: 1, output: diff.output }
      : { status: 0, output: `no changes against ${base}` };
  },
  /** Every audit tool that is installed; findings from any of them are work. */
  'dependency-audit': (root) => {
    const parts = [sh(root, 'pnpm audit --audit-level high')];
    if (sh(root, 'cargo audit --version').status === 0) parts.push(sh(root, 'cargo audit'));
    const found = parts.filter((part) => part.status !== 0);
    return found.length
      ? { status: 1, output: found.map((part) => part.output).join('\n') }
      : { status: 0, output: 'no known vulnerabilities at high severity or above' };
  },
};

export function runSignal(root, signal, policy) {
  return SIGNALS[signal] ? SIGNALS[signal](root, policy) : sh(root, signal);
}
