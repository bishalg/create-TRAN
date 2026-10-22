#!/usr/bin/env node
/**
 * `pnpm metrics` (ADR-0031): measures web performance and the size of every deliverable, judges the
 * run against `budgets.json` and the committed history, and with `--record` appends it to
 * `docs/reports/metrics.json` and regenerates `docs/reports/metrics.md`.
 *
 *   pnpm metrics                    measure and judge; nothing committed changes
 *   pnpm metrics --native           also build and measure the release APK and iOS app
 *   pnpm metrics --record           …and append the run to the history (refused if it fails)
 *   pnpm metrics --record --accept  record a failing run on purpose (say why in the commit)
 *   pnpm metrics --no-build         judge the last measurement again without rebuilding
 *
 * Every metric has a kind, which decides what it may be compared with:
 *   score   Lighthouse 0–100, simulated throttling: any machine; fails >5 points below the last record
 *   size    web gzip, APK, iOS app: any machine; fails >5% above the last record
 *   binary  native executables differ per OS: same platform only; >5%
 *   timing  wall-clock: same machine only; fails >25% *and* >50 ms above the last record
 *   ratio   layout shift: budget only
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const RULES = {
  score: { scope: 'all', drop: 5 },
  size: { scope: 'all', relative: 0.05 },
  binary: { scope: 'platform', relative: 0.05 },
  timing: { scope: 'machine', relative: 0.25, absolute: 50 },
  ratio: { scope: 'none' },
};

/** Display names, in report order. */
export const LABELS = {
  'web.lighthouse.performance': 'Lighthouse performance',
  'web.lighthouse.accessibility': 'Lighthouse accessibility',
  'web.lighthouse.best-practices': 'Lighthouse best practices',
  'web.lighthouse.seo': 'Lighthouse SEO',
  'web.fcp': 'First contentful paint',
  'web.lcp': 'Largest contentful paint',
  'web.tbt': 'Total blocking time',
  'web.cls': 'Cumulative layout shift',
  'web.speed-index': 'Speed index',
  'web.ttfb': 'Time to first byte',
  'web.dom-content-loaded': 'DOM content loaded',
  'web.load': 'Load',
  'web.js.gzip': 'Web JS (gzip)',
  'web.css.gzip': 'Web CSS (gzip)',
  'android.apk': 'Android APK',
  'ios.app': 'iOS app',
  'api.binary': 'API binary',
  'core.native-lib': 'Rust core library',
};

const HISTORY_COLUMNS = [
  ['web.lighthouse.performance', 'Perf'],
  ['web.lighthouse.accessibility', 'A11y'],
  ['web.lcp', 'LCP'],
  ['web.load', 'Load'],
  ['web.js.gzip', 'JS gz'],
  ['web.css.gzip', 'CSS gz'],
  ['android.apk', 'APK'],
  ['ios.app', 'iOS app'],
  ['api.binary', 'API bin'],
  ['core.native-lib', 'Rust lib'],
];

/** What `collectSizes` measures; paths are relative to the repository root. */
export const SIZE_ARTIFACTS = [
  { id: 'web.js.gzip', kind: 'size', assets: 'apps/web/dist/assets', ext: '.js' },
  { id: 'web.css.gzip', kind: 'size', assets: 'apps/web/dist/assets', ext: '.css' },
  {
    id: 'android.apk',
    kind: 'size',
    path: 'apps/android/app/build/outputs/apk/release/app-release-unsigned.apk',
  },
  {
    id: 'ios.app',
    kind: 'size',
    path: '.metrics/ios/Build/Products/Release-iphonesimulator/TranVotingDemo.app',
  },
  { id: 'api.binary', kind: 'binary', path: 'target/release/api' },
  {
    id: 'core.native-lib',
    kind: 'binary',
    path: (platform) => `target/release/libtran_uniffi.${platform === 'darwin' ? 'dylib' : 'so'}`,
  },
];

/** Bytes of a file, or of every file under a folder (an `.app` bundle); symlinks count as links. */
function bytesOf(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((sum, entry) => sum + bytesOf(join(path, entry)), 0);
}

/** Sizes of every deliverable that is built; one that is not is `missing`, never 0. */
export function collectSizes(root, platform = process.platform) {
  const sizes = {};
  for (const artifact of SIZE_ARTIFACTS) {
    let value = null;
    if (artifact.assets) {
      const dir = join(root, artifact.assets);
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(artifact.ext)) : [];
      if (files.length) {
        value = files.reduce(
          (sum, f) => sum + gzipSync(readFileSync(join(dir, f)), { level: 9 }).length,
          0
        );
      }
    } else {
      const relative =
        typeof artifact.path === 'function' ? artifact.path(platform) : artifact.path;
      const path = join(root, relative);
      if (existsSync(path)) value = bytesOf(path);
    }
    sizes[artifact.id] = {
      value,
      unit: 'bytes',
      kind: artifact.kind,
      ...(value === null && { missing: true }),
    };
  }
  return sizes;
}

function comparable(kind, a, b) {
  const scope = RULES[kind]?.scope ?? 'none';
  if (scope === 'all') return true;
  if (scope === 'platform') return a.platform === b.platform;
  if (scope === 'machine') return a.label === b.label;
  return false;
}

/** The latest record holding `id` that this run may be compared with. */
function previousOf(id, kind, machine, records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const value = records[i].metrics[id]?.value;
    if (value != null && comparable(kind, machine, records[i].machine)) return value;
  }
  return null;
}

/**
 * One row per metric: its value, the comparable previous value, the change, and whether it
 * passes. `ok` is false when any metric is over budget or regressed.
 */
export function judge(current, records, budgets) {
  const rows = Object.entries(current.metrics).map(([id, { value, unit, kind }]) => {
    const row = { id, label: LABELS[id] ?? id, value, unit, kind, budget: budgets[id] ?? null };
    if (value == null) return { ...row, previous: null, change: null, status: 'missing' };
    const previous = previousOf(id, kind, current.machine, records);
    const change = previous ? Math.round(((value - previous) / previous) * 1000) / 1000 : null;
    const fail = (reason) => ({ ...row, previous, change, status: 'fail', reason });

    if (row.budget?.max != null && value > row.budget.max)
      return fail(
        `${formatValue(value, unit)} is over budget ${formatValue(row.budget.max, unit)}`
      );
    if (row.budget?.min != null && value < row.budget.min)
      return fail(
        `${formatValue(value, unit)} is below budget ${formatValue(row.budget.min, unit)}`
      );
    if (previous == null) return { ...row, previous, change, status: 'baseline' };

    const rule = RULES[kind] ?? {};
    if (rule.drop != null && previous - value > rule.drop)
      return fail(`${value - previous} points below the last record (${previous})`);
    if (
      rule.relative != null &&
      value > previous * (1 + rule.relative) &&
      value - previous > (rule.absolute ?? 0)
    ) {
      const percent = (((value - previous) / previous) * 100).toFixed(1);
      return fail(`+${percent}% over the last record (${formatValue(previous, unit)})`);
    }
    return { ...row, previous, change, status: 'ok' };
  });
  return { rows, ok: rows.every((row) => row.status !== 'fail') };
}

export function appendRecord(history, record) {
  return { ...history, records: [...history.records, record] };
}

export function formatValue(value, unit) {
  if (value == null) return 'missing';
  if (unit === 'bytes') {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  }
  if (unit === 'ms') return `${Math.round(value)} ms`;
  if (unit === 'ratio') return value.toFixed(3);
  return String(Math.round(value));
}

const percent = (change) => `${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;

function formatBudget(budget, unit) {
  if (!budget) return '—';
  if (budget.max != null) return `≤ ${formatValue(budget.max, unit)}`;
  return `≥ ${formatValue(budget.min, unit)}`;
}

/** The committed report: the latest run against the first comparable one, then the history. */
export function renderMarkdown(history, budgets) {
  const lines = [
    '# Metrics report',
    '',
    '> Generated by `pnpm metrics --record` from [`metrics.json`](metrics.json) — do not edit. How the numbers are',
    '> measured and judged: [ADR-0031](../adr/0031-visual-and-performance-baselines.md).',
    '',
  ];
  const { records } = history;
  if (!records.length)
    return [...lines, 'No runs recorded yet: `pnpm metrics --record`.', ''].join('\n');

  const latest = records.at(-1);
  lines.push(
    `Latest: ${latest.date.slice(0, 10)} · \`${latest.commit}\` · ${latest.machine.label}. Baseline is the first`,
    'record each metric can be compared with (timings: same machine; native binaries: same platform).',
    '',
    '| Metric | Latest | Baseline | Change | Budget |',
    '| --- | --- | --- | --- | --- |'
  );
  const ids = [
    ...Object.keys(LABELS).filter((id) => id in latest.metrics),
    ...Object.keys(latest.metrics).filter((id) => !(id in LABELS)),
  ];
  for (const id of ids) {
    const { value, unit, kind } = latest.metrics[id];
    const label = LABELS[id] ?? id;
    if (value == null) {
      lines.push(`| ${label} | missing | — | — | ${formatBudget(budgets[id], unit)} |`);
      continue;
    }
    // The latest record always qualifies, so there is always a first one.
    const first = records.find(
      (r) =>
        r === latest ||
        (r.metrics[id]?.value != null && comparable(kind, latest.machine, r.machine))
    );
    const base = first.metrics[id].value;
    const change = base ? percent((value - base) / base) : '—';
    lines.push(
      `| ${label} | ${formatValue(value, unit)} | ${formatValue(base, unit)} | ${change} | ${formatBudget(budgets[id], unit)} |`
    );
  }

  lines.push(
    '',
    '## History',
    '',
    `| Date | Commit | Machine | ${HISTORY_COLUMNS.map(([, title]) => title).join(' | ')} |`,
    `| --- | --- | --- | ${HISTORY_COLUMNS.map(() => '---').join(' | ')} |`
  );
  for (const r of records) {
    const cells = HISTORY_COLUMNS.map(([id]) => {
      const metric = r.metrics[id];
      return metric?.value == null ? '—' : formatValue(metric.value, metric.unit);
    });
    lines.push(
      `| ${r.date.slice(0, 10)} | ${r.commit} | ${r.machine.label} | ${cells.join(' | ')} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

/* c8 ignore start — the CLI: builds, runs tools and writes files; the logic above is tested. */
function machine() {
  const cpus = os.cpus();
  const platform = `${process.platform}-${process.arch}`;
  return {
    label: `${platform} · ${cpus[0]?.model.trim() ?? 'unknown CPU'} · ${cpus.length} cores`,
    platform,
  };
}

function run(command, args, cwd, env = {}) {
  console.log(`metrics: $ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
}

function measure(root, native) {
  rmSync(join(root, '.metrics/runs'), { recursive: true, force: true });
  run('cargo', ['build', '--release', '-p', 'api', '-p', 'tran-uniffi', '--quiet'], root);
  run('pnpm', ['run', 'build:libs'], root);
  run(
    'pnpm',
    [
      '--filter',
      'e2e',
      'exec',
      'playwright',
      'test',
      '-c',
      'playwright.metrics.config.ts',
      '--project',
      'perf',
    ],
    root,
    { PERF: '1' }
  );
  if (native) run('bash', ['scripts/build-release.sh'], root);
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

function commit(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain') ? '-dirty' : '');
}

function main(root, argv) {
  const flags = new Set(argv);
  if (!flags.has('--no-build')) measure(root, flags.has('--native'));

  const runsDir = join(root, '.metrics/runs');
  const measured = existsSync(runsDir)
    ? readdirSync(runsDir).map((f) => readJson(join(runsDir, f), {}).metrics ?? {})
    : [];
  const current = {
    date: new Date().toISOString(),
    commit: commit(root),
    machine: machine(),
    metrics: Object.assign({}, ...measured, collectSizes(root)),
  };

  const historyPath = join(root, 'docs/reports/metrics.json');
  const history = readJson(historyPath, { schema: 1, records: [] });
  const budgets = readJson(join(root, 'tooling/metrics/budgets.json'), {});
  delete budgets.$comment;
  const { rows, ok } = judge(current, history.records, budgets);

  console.log(`\nmetrics: ${current.machine.label} · ${current.commit}`);
  const mark = { ok: '✓', baseline: '•', missing: '–', fail: '✗' };
  for (const row of rows) {
    const change = row.change == null ? '' : ` (${percent(row.change)})`;
    const detail = row.status === 'fail' ? `  ← ${row.reason}` : '';
    console.log(
      `  ${mark[row.status]} ${row.label.padEnd(28)} ${formatValue(row.value, row.unit)}${change}${detail}`
    );
  }
  mkdirSync(join(root, '.metrics'), { recursive: true });
  writeFileSync(join(root, '.metrics/latest.json'), `${JSON.stringify(current, null, 2)}\n`);

  if (!ok && !flags.has('--accept')) {
    console.error(
      '\nmetrics: failed (✗ above). Fix it, or record on purpose with --record --accept.'
    );
    process.exit(1);
  }
  if (flags.has('--record')) {
    const next = appendRecord(history, current);
    mkdirSync(join(root, 'docs/reports'), { recursive: true });
    writeFileSync(historyPath, `${JSON.stringify(next, null, 2)}\n`);
    writeFileSync(join(root, 'docs/reports/metrics.md'), renderMarkdown(next, budgets));
    const first = history.records.length === 0 ? ' as the baseline' : '';
    console.log(`\nmetrics: recorded${first} in docs/reports/metrics.{json,md}; commit both.`);
  } else {
    console.log('\nmetrics: ok. `pnpm metrics --record` adds this run to docs/reports/.');
  }
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main(process.cwd(), process.argv.slice(2));
/* c8 ignore stop */
