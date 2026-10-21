// Verifies: REQ-PERF-005, REQ-PERF-006
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  appendRecord,
  collectSizes,
  formatValue,
  judge,
  renderMarkdown,
  SIZE_ARTIFACTS,
} from './metrics.mjs';

const HERE = { label: 'darwin-arm64 · M3 · 8 cores', platform: 'darwin-arm64' };
const ELSEWHERE = { label: 'linux-x64 · Xeon · 4 cores', platform: 'linux-x64' };

const record = (metrics, machine = HERE, date = '2026-10-01T00:00:00.000Z') => ({
  date,
  commit: 'abc1234',
  machine,
  metrics,
});
const m = (
  value,
  kind,
  unit = { score: 'score', timing: 'ms', ratio: 'ratio' }[kind] ?? 'bytes'
) => ({
  value,
  unit,
  kind,
});
const statusOf = (rows, id) => rows.find((row) => row.id === id)?.status;

describe('collectSizes (REQ-PERF-005)', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tran-metrics-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reports an artefact that is not built as missing, never as zero', () => {
    const sizes = collectSizes(root, 'darwin');
    for (const { id } of SIZE_ARTIFACTS) {
      assert.equal(sizes[id].value, null, id);
      assert.equal(sizes[id].missing, true, id);
    }
  });

  it('sums the gzipped size of every web script and stylesheet', () => {
    const assets = join(root, 'apps/web/dist/assets');
    mkdirSync(assets, { recursive: true });
    const a = 'const a = 1;\n'.repeat(50);
    const b = 'export const b = 2;\n';
    writeFileSync(join(assets, 'index-1.js'), a);
    writeFileSync(join(assets, 'vendor-2.js'), b);
    writeFileSync(join(assets, 'index-3.css'), 'body{margin:0}');
    writeFileSync(join(assets, 'logo.svg'), '<svg/>');
    const sizes = collectSizes(root, 'darwin');
    assert.equal(
      sizes['web.js.gzip'].value,
      gzipSync(a, { level: 9 }).length + gzipSync(b, { level: 9 }).length
    );
    assert.equal(sizes['web.css.gzip'].value, gzipSync('body{margin:0}', { level: 9 }).length);
    assert.equal(sizes['web.js.gzip'].kind, 'size');
  });

  it('measures files as bytes and app bundles as the sum of their files', () => {
    mkdirSync(join(root, 'target/release'), { recursive: true });
    writeFileSync(join(root, 'target/release/api'), Buffer.alloc(1000));
    writeFileSync(join(root, 'target/release/libtran_uniffi.so'), Buffer.alloc(300));
    const app = join(
      root,
      '.metrics/ios/Build/Products/Release-iphonesimulator/TranVotingDemo.app'
    );
    mkdirSync(join(app, 'Frameworks'), { recursive: true });
    writeFileSync(join(app, 'TranVotingDemo'), Buffer.alloc(40));
    writeFileSync(join(app, 'Frameworks/lib.dylib'), Buffer.alloc(2));
    const sizes = collectSizes(root, 'linux');
    assert.equal(sizes['api.binary'].value, 1000);
    assert.equal(sizes['core.native-lib'].value, 300);
    assert.equal(sizes['ios.app'].value, 42);
    // Native binaries differ per OS, so they are only compared on the same platform.
    assert.equal(sizes['api.binary'].kind, 'binary');
  });

  it('looks for the native library under the name this OS gives it', () => {
    mkdirSync(join(root, 'target/release'), { recursive: true });
    writeFileSync(join(root, 'target/release/libtran_uniffi.dylib'), Buffer.alloc(7));
    assert.equal(collectSizes(root, 'darwin')['core.native-lib'].value, 7);
    assert.equal(collectSizes(root, 'linux')['core.native-lib'].value, null);
  });
});

describe('judge (REQ-PERF-006)', () => {
  it('treats the first run as the baseline: nothing to compare, nothing fails', () => {
    const { rows, ok } = judge(record({ 'web.lcp': m(500, 'timing') }), [], {});
    assert.equal(ok, true);
    assert.equal(statusOf(rows, 'web.lcp'), 'baseline');
  });

  it('fails a metric beyond its budget and names it', () => {
    const current = record({
      'web.lighthouse.performance': m(80, 'score'),
      'web.cls': m(0.2, 'ratio'),
      'web.lcp': m(900, 'timing'),
    });
    const budgets = {
      'web.lighthouse.performance': { min: 90 },
      'web.cls': { max: 0.1 },
      'web.lcp': { max: 2500 },
    };
    const { rows, ok } = judge(current, [], budgets);
    assert.equal(ok, false);
    assert.equal(statusOf(rows, 'web.lighthouse.performance'), 'fail');
    assert.match(rows.find((r) => r.id === 'web.lighthouse.performance').reason, /below budget 90/);
    assert.equal(statusOf(rows, 'web.cls'), 'fail');
    assert.match(rows.find((r) => r.id === 'web.cls').reason, /over budget 0\.1/);
    assert.equal(statusOf(rows, 'web.lcp'), 'baseline');
  });

  it('fails a size more than 5% above the last record, from any machine', () => {
    const history = [record({ 'web.js.gzip': m(1000, 'size') }, ELSEWHERE)];
    assert.equal(judge(record({ 'web.js.gzip': m(1050, 'size') }), history, {}).ok, true);
    const { rows, ok } = judge(record({ 'web.js.gzip': m(1051, 'size') }), history, {});
    assert.equal(ok, false);
    assert.match(rows[0].reason, /\+5\.1% over the last record/);
  });

  it('compares native binaries only with records from the same platform', () => {
    const history = [record({ 'api.binary': m(1000, 'binary') }, ELSEWHERE)];
    const { rows, ok } = judge(record({ 'api.binary': m(5000, 'binary') }), history, {});
    assert.equal(ok, true);
    assert.equal(rows[0].status, 'baseline');
    const same = [
      record({ 'api.binary': m(1000, 'binary') }, { ...ELSEWHERE, platform: HERE.platform }),
    ];
    assert.equal(judge(record({ 'api.binary': m(5000, 'binary') }), same, {}).ok, false);
  });

  it('fails a timing more than 25% (and 50 ms) slower than the last run on this machine', () => {
    const history = [record({ 'web.load': m(400, 'timing') })];
    assert.equal(judge(record({ 'web.load': m(500, 'timing') }), history, {}).ok, true);
    assert.equal(judge(record({ 'web.load': m(501, 'timing') }), history, {}).ok, false);
  });

  it('ignores timing noise below 50 ms, however large in percent', () => {
    const history = [record({ 'web.ttfb': m(3, 'timing') })];
    assert.equal(judge(record({ 'web.ttfb': m(40, 'timing') }), history, {}).ok, true);
  });

  it('shows a timing from another machine but does not judge it', () => {
    const history = [record({ 'web.load': m(100, 'timing') }, ELSEWHERE)];
    const { rows, ok } = judge(record({ 'web.load': m(900, 'timing') }), history, {});
    assert.equal(ok, true);
    assert.equal(rows[0].status, 'baseline');
  });

  it('fails a score that drops more than 5 points below the last record', () => {
    const history = [record({ 'web.lighthouse.performance': m(100, 'score') }, ELSEWHERE)];
    assert.equal(
      judge(record({ 'web.lighthouse.performance': m(95, 'score') }), history, {}).ok,
      true
    );
    const { rows, ok } = judge(
      record({ 'web.lighthouse.performance': m(94, 'score') }),
      history,
      {}
    );
    assert.equal(ok, false);
    assert.match(rows[0].reason, /-6 points/);
  });

  it('compares with the latest record that has the metric, not just the last one', () => {
    const history = [
      record({ 'android.apk': m(1000, 'size') }),
      record({ 'android.apk': m(null, 'size') }),
    ];
    const { rows } = judge(record({ 'android.apk': m(2000, 'size') }), history, {});
    assert.equal(rows[0].previous, 1000);
    assert.equal(rows[0].status, 'fail');
  });

  it('reports a missing artefact without failing, even with a budget', () => {
    const { rows, ok } = judge(
      record({ 'ios.app': { value: null, unit: 'bytes', kind: 'size', missing: true } }),
      [record({ 'ios.app': m(10, 'size') })],
      { 'ios.app': { max: 5 } }
    );
    assert.equal(ok, true);
    assert.equal(rows[0].status, 'missing');
  });

  it('passes an improvement and reports the change', () => {
    const { rows, ok } = judge(
      record({ 'web.js.gzip': m(900, 'size') }),
      [record({ 'web.js.gzip': m(1000, 'size') })],
      {}
    );
    assert.equal(ok, true);
    assert.equal(rows[0].status, 'ok');
    assert.equal(rows[0].change, -0.1);
  });
});

describe('history (REQ-PERF-006)', () => {
  it('appends without changing earlier records', () => {
    const first = record({ 'web.js.gzip': m(1, 'size') });
    const history = { schema: 1, records: [first] };
    const next = appendRecord(history, record({ 'web.js.gzip': m(2, 'size') }));
    assert.equal(history.records.length, 1);
    assert.deepEqual(
      next.records.map((r) => r.metrics['web.js.gzip'].value),
      [1, 2]
    );
  });

  it('renders the latest run against the baseline, plus one history row per record', () => {
    const history = {
      schema: 1,
      records: [
        record({ 'web.js.gzip': m(2048, 'size'), 'web.lighthouse.performance': m(100, 'score') }),
        record(
          {
            'web.js.gzip': m(3072, 'size'),
            'web.lighthouse.performance': m(98, 'score'),
            'android.apk': { value: null, unit: 'bytes', kind: 'size', missing: true },
          },
          HERE,
          '2026-10-02T00:00:00.000Z'
        ),
      ],
    };
    const md = renderMarkdown(history, { 'web.js.gzip': { max: 200000 } });
    assert.match(md, /do not edit/);
    assert.match(md, /\| Web JS \(gzip\) \| 3\.0 KiB \| 2\.0 KiB \| \+50\.0% \| ≤ 195\.3 KiB \|/);
    assert.match(md, /\| Android APK \| missing \|/);
    assert.match(md, /\| 2026-10-01 \| abc1234 \|/);
    assert.match(md, /\| 2026-10-02 \| abc1234 \|/);
  });

  it('says so when nothing has been recorded yet', () => {
    assert.match(renderMarkdown({ schema: 1, records: [] }, {}), /No runs recorded yet/);
  });
});

describe('formatValue', () => {
  it('formats each unit for people', () => {
    assert.equal(formatValue(512, 'bytes'), '512 B');
    assert.equal(formatValue(1536, 'bytes'), '1.5 KiB');
    assert.equal(formatValue(5 * 1024 * 1024, 'bytes'), '5.0 MiB');
    assert.equal(formatValue(382.526, 'ms'), '383 ms');
    assert.equal(formatValue(91, 'score'), '91');
    assert.equal(formatValue(0.0123, 'ratio'), '0.012');
    assert.equal(formatValue(null, 'ms'), 'missing');
  });
});
