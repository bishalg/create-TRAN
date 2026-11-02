// Verifies: REQ-ISS-002, REQ-ISS-005, REQ-ISS-006, REQ-ISS-007, REQ-ISS-020
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  applyTriageLabel,
  DEFAULT_SECTIONS,
  mergeVerdicts,
  parseJudgment,
  parseMarker,
  readState,
  readTemplate,
  renderGateComment,
  renderMarker,
  rewriteSkeleton,
  setStatusLabel,
  sizeClass,
  structuralVerdict,
  templateHints,
  templateSections,
  upsertStageComment,
} from './agents.mjs';
import { event, fakeGitHub, POLICY, ROOT } from './test-helpers.mjs';

const STORY = readFileSync(join(ROOT, '.github/ISSUE_TEMPLATE/story.md'), 'utf8');
const COMPLETE = event('issue-opened-complete').issue.body;
const COMPLEX_WHEN = POLICY.issues.complexWhen;

describe('the story template (REQ-ISS-005)', () => {
  it("reads the template's sections (REQ-ISS-005)", () => {
    assert.deepEqual(templateSections(STORY), [
      'Story',
      'Requirement ids',
      'Acceptance criteria',
      'Out of scope',
      'Definition of done',
    ]);
    assert.deepEqual(templateSections(null), DEFAULT_SECTIONS);
    assert.deepEqual(DEFAULT_SECTIONS, templateSections(STORY));
    // A repo without the folder: the defaults; a folder without story.md: its first template.
    const bare = mkdtempSync(join(tmpdir(), 'issue-template-'));
    assert.equal(readTemplate(bare), null);
    mkdirSync(join(bare, '.github/ISSUE_TEMPLATE'), { recursive: true });
    writeFileSync(join(bare, '.github/ISSUE_TEMPLATE/config.yml'), 'blank_issues_enabled: true\n');
    writeFileSync(join(bare, '.github/ISSUE_TEMPLATE/bug.md'), '---\nname: Bug\n---\n\n## Steps\n');
    assert.deepEqual(templateSections(readTemplate(bare)), ['Steps']);
    assert.equal(readTemplate(ROOT), STORY);
  });

  it("keeps each section's hint, the template's own HTML comment", () => {
    const hints = templateHints(STORY);
    assert.match(hints['Acceptance criteria'], /^<!--[\s\S]*Given <context>[\s\S]*-->$/);
    assert.match(hints['Out of scope'], /deliberately does not do/);
    assert.deepEqual(templateHints(null), {});
  });
});

describe('structural tier (REQ-ISS-005)', () => {
  it('structural tier (REQ-ISS-005)', () => {
    assert.deepEqual(structuralVerdict('', DEFAULT_SECTIONS), {
      verdict: 'needs-detail',
      reasons: [
        'Story: missing',
        'Requirement ids: no REQ- id',
        'Acceptance criteria: no Given/When/Then line',
        'Out of scope: missing',
        'Definition of done: missing',
      ],
    });
    const noCriteria = COMPLETE.replace(/(## Acceptance criteria\n)[\s\S]*?(\n## Out)/, '$1$2');
    assert.deepEqual(structuralVerdict(noCriteria, DEFAULT_SECTIONS), {
      verdict: 'needs-detail',
      reasons: ['Acceptance criteria: no Given/When/Then line'],
    });
    const noIds = COMPLETE.replace('REQ-RULE-009\n', 'none yet\n');
    assert.deepEqual(structuralVerdict(noIds, DEFAULT_SECTIONS).reasons, [
      'Requirement ids: no REQ- id',
    ]);
    assert.deepEqual(structuralVerdict(COMPLETE, DEFAULT_SECTIONS), {
      verdict: 'ready',
      reasons: [],
    });
  });

  it('the untouched template fails: its hints are HTML comments, never content', () => {
    const body = STORY.replace(/^---[\s\S]*?---\n/, '');
    assert.match(body, /REQ-X{3}-0{2}1/); // the hint's id, inside an HTML comment
    assert.deepEqual(structuralVerdict(body, DEFAULT_SECTIONS).reasons, [
      'Story: empty',
      'Requirement ids: no REQ- id',
      'Acceptance criteria: no Given/When/Then line',
      'Out of scope: empty',
      'Definition of done: empty',
    ]);
  });

  it('accepts ### headings (issue forms), any case, and ignores headings inside code', () => {
    const forms = COMPLETE.replace(/^## /gm, '### ').replace(
      '### Out of scope',
      '### OUT OF SCOPE:'
    );
    assert.equal(structuralVerdict(forms, DEFAULT_SECTIONS).verdict, 'ready');
    const fenced = '```\n## Story\nAs a voter\n```\n';
    assert.ok(structuralVerdict(fenced, DEFAULT_SECTIONS).reasons.includes('Story: missing'));
  });
});

describe('judgment tier (REQ-ISS-005)', () => {
  const ready = { verdict: 'ready', reasons: [] };
  const weak = { verdict: 'needs-detail', reasons: ['Story: missing'] };

  it('the judgment tier never upgrades (REQ-ISS-005)', () => {
    assert.deepEqual(mergeVerdicts(weak, 'VERDICT: ready\n- Story: fine'), {
      verdict: 'needs-detail',
      reasons: ['Story: missing'],
      tier: 'structural',
      modelSize: null,
      rewrite: null,
    });
    const decided = mergeVerdicts(ready, 'VERDICT: human-decision-needed\n- Story: pick a market');
    assert.equal(decided.verdict, 'human-decision-needed');
    assert.deepEqual(decided.reasons, ['Story: pick a market']);
    assert.equal(decided.tier, 'judgment');
    for (const report of ['Looks fine to me.', '', 'VERDICT: excellent'])
      assert.deepEqual(mergeVerdicts(ready, report).verdict, 'human-decision-needed');
    assert.deepEqual(mergeVerdicts(ready, 'no verdict here').reasons, [
      'the model returned no verdict',
    ]);
    assert.deepEqual(mergeVerdicts(ready, 'VERDICT: excellent').reasons, [
      'the model returned no verdict',
    ]);
    // Skipped judgment: the structural result stands.
    assert.equal(mergeVerdicts(ready, null).verdict, 'ready');
    assert.equal(mergeVerdicts(ready, null).tier, 'structural');
  });

  it('reads VERDICT on the first line, SIZE, reasons, REWRITE and PLAN blocks', () => {
    const report = [
      '',
      'VERDICT: needs-detail',
      'SIZE: complex',
      '- Story: who is the user?',
      '* Out of scope: empty',
      '',
      'REWRITE:',
      '## Story',
      '',
      'As a voter …',
      '',
      'PLAN:',
      '- Goal: x',
    ].join('\n');
    assert.deepEqual(parseJudgment(report), {
      verdict: 'needs-detail',
      size: 'complex',
      reasons: ['Story: who is the user?', 'Out of scope: empty'],
      rewrite: '## Story\n\nAs a voter …',
      plan: '- Goal: x',
    });
    // A VERDICT further down does not count: the hand-off is the first line.
    assert.equal(parseJudgment('Sure!\nVERDICT: ready').verdict, null);
    assert.equal(parseJudgment('VERDICT: Ready').verdict, 'ready');
  });
});

describe('rewrite (REQ-ISS-006)', () => {
  const hints = templateHints(STORY);

  it("the rewrite keeps the author's words (REQ-ISS-006)", () => {
    const issue = {
      title: 'Add country lookup',
      body: [
        'We need a lookup.',
        '',
        '## Acceptance criteria',
        '',
        '- Given +977, When entered, Then Nepal.',
        '',
        '## Notes',
        '',
        'Ask Maria.',
      ].join('\n'),
    };
    const text = rewriteSkeleton(issue, DEFAULT_SECTIONS, hints);
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, DEFAULT_SECTIONS);
    const section = (name) => text.split(`## ${name}\n`)[1].split('\n## ')[0].trim();
    assert.match(section('Story'), /^We need a lookup\./);
    assert.match(section('Story'), /\*\*Notes\*\*\n\nAsk Maria\./);
    assert.equal(section('Acceptance criteria'), '- Given +977, When entered, Then Nepal.');
    assert.equal(section('Requirement ids'), hints['Requirement ids']);
    assert.equal(section('Out of scope'), hints['Out of scope']);
    // Without the template's hints every empty section still gets one.
    const bare = rewriteSkeleton({ title: 't', body: '' }, DEFAULT_SECTIONS);
    assert.equal((bare.match(/<!--/g) ?? []).length, DEFAULT_SECTIONS.length);
    // Still needs-detail: the author has to fill in the ids.
    assert.equal(structuralVerdict(text, DEFAULT_SECTIONS).verdict, 'needs-detail');
  });
});

describe('size class (REQ-ISS-007)', () => {
  const issue = (body) => ({ title: 'T', body });

  it('size class with reasons (REQ-ISS-007)', () => {
    const migration = sizeClass(issue('Add a column in supabase/migrations.'), COMPLEX_WHEN, 300);
    assert.equal(migration.size, 'complex');
    assert.deepEqual(migration.reasons, ['mentions "migration"']);
    assert.deepEqual(sizeClass(issue('Fix the auth redirect.'), COMPLEX_WHEN, 300).reasons, [
      'mentions "auth"',
    ]);
    assert.deepEqual(sizeClass(issue('Add zod to package.json.'), COMPLEX_WHEN, 300).reasons, [
      'mentions "package.json"',
    ]);
    const paths = 'a/b.ts c/d.ts e/f.rs g/h.kt i/j.swift k/l.md';
    assert.deepEqual(sizeClass(issue(paths), COMPLEX_WHEN, 300), {
      size: 'complex',
      reasons: ['names 6 file paths (more than 5)'],
    });
    assert.deepEqual(sizeClass(issue('Estimated lines: 420'), COMPLEX_WHEN, 300).reasons, [
      'estimates 420 changed lines (budget 300)',
    ]);
    assert.deepEqual(
      sizeClass(issue('Cover `crates/rust-core/tests/age.rs`.'), COMPLEX_WHEN, 300),
      {
        size: 'simple',
        reasons: ['names 1 file path (at most 5)', 'no keyword from issues.complexWhen'],
      }
    );
    // "author" is not "auth": keywords match whole words and their plurals.
    assert.equal(sizeClass(issue('As an author I want…'), COMPLEX_WHEN, 300).size, 'simple');
    assert.equal(sizeClass(issue(COMPLETE), COMPLEX_WHEN, 300).size, 'simple');
  });

  it('the model may raise the size, never lower it', () => {
    const raised = sizeClass(issue('One test.'), COMPLEX_WHEN, 300, 'complex');
    assert.equal(raised.size, 'complex');
    assert.ok(raised.reasons.includes('the judgment tier said SIZE: complex'));
    const kept = sizeClass(issue('Edit auth.'), COMPLEX_WHEN, 300, 'simple');
    assert.equal(kept.size, 'complex');
    assert.ok(!kept.reasons.some((reason) => /judgment/.test(reason)));
  });
});

describe('triage labels (REQ-ISS-002)', () => {
  it('exactly one triage label, others kept, created on first use (REQ-ISS-002)', () => {
    const gh = fakeGitHub({ labels: ['bug', 'needs-detail', 'agent:running'] });
    applyTriageLabel(gh, 12, 'approval-needed', POLICY);
    const methods = gh.calls.map((c) => c.method);
    assert.deepEqual(methods, ['ensureLabels', 'getLabels', 'setLabels']);
    assert.deepEqual(gh.calls[0].args[0], [
      'needs-detail',
      'approval-needed',
      'human-decision-needed',
      'review-needed',
      'good-to-merge',
      'agent:running',
      'agent:failed',
    ]);
    // Status labels are not triage labels: they stay until their own helper moves them.
    assert.deepEqual(gh.calls[2].args, [12, ['bug', 'agent:running', 'approval-needed']]);
  });

  it('no write when the label is already the only triage label; renamed labels count', () => {
    const gh = fakeGitHub({ labels: ['bug', 'approval-needed'] });
    applyTriageLabel(gh, 12, 'approval-needed', POLICY);
    assert.ok(!gh.calls.some((c) => c.method === 'setLabels'));
    const policy = { ...POLICY, labels: { ...POLICY.labels, 'needs-detail': 'triage: more info' } };
    const renamed = fakeGitHub({ labels: ['needs-detail', 'approval-needed'] });
    applyTriageLabel(renamed, 12, 'needs-detail', policy);
    // The renamed label is the runner's; the default name is now an ordinary label it keeps.
    assert.deepEqual(renamed.state.labels, ['needs-detail', 'triage: more info']);
    assert.throws(() => applyTriageLabel(gh, 12, 'running', POLICY), /not a triage label/);
  });

  it('status labels are added and removed on their own', () => {
    const gh = fakeGitHub({ labels: ['bug', 'approval-needed'] });
    setStatusLabel(gh, 12, 'running', true, POLICY);
    assert.deepEqual(gh.state.labels, ['bug', 'approval-needed', 'agent:running']);
    setStatusLabel(gh, 12, 'running', false, POLICY);
    setStatusLabel(gh, 12, 'failed', false, POLICY);
    assert.deepEqual(gh.state.labels, ['bug', 'approval-needed']);
    assert.equal(gh.calls.filter((c) => c.method === 'setLabels').length, 2);
  });
});

describe('markers and state (REQ-ISS-020)', () => {
  const gate = (data) => `${renderMarker({ stage: 'gate', ...data })}\nold body`;

  it('state is read back from markers (REQ-ISS-020)', () => {
    const gh = fakeGitHub({
      labels: ['bug', 'needs-detail', 'agent:failed'],
      comments: [
        { id: 7, body: 'a person', user: { login: 'alice' } },
        { id: 8, body: gate({ verdict: 'needs-detail', harness: 'fake' }) },
      ],
    });
    const { id } = upsertStageComment(gh, 12, 'gate', 'new body', {
      verdict: 'ready',
      size: 'simple',
    });
    assert.equal(id, 8);
    const update = gh.calls.find((c) => c.method === 'updateComment');
    assert.equal(update.args[0], 8);
    assert.deepEqual(parseMarker(update.args[1]), {
      stage: 'gate',
      verdict: 'ready',
      size: 'simple',
    });
    assert.ok(update.args[1].endsWith('\nnew body'));
    assert.ok(!gh.calls.some((c) => c.method === 'createComment'));
    assert.deepEqual(readState(gh, 12, POLICY), {
      label: 'needs-detail',
      status: ['failed'],
      stages: { gate: { stage: 'gate', verdict: 'ready', size: 'simple', commentId: 8 } },
    });

    const fresh = fakeGitHub();
    upsertStageComment(fresh, 12, 'gate', 'first');
    upsertStageComment(fresh, 12, 'ignored', 'other stage');
    assert.equal(fresh.calls.filter((c) => c.method === 'createComment').length, 2);
    upsertStageComment(fresh, 12, 'gate', 'second');
    assert.equal(fresh.calls.filter((c) => c.method === 'createComment').length, 2);
    assert.deepEqual(readState(fresh, 12, POLICY).label, null);
    assert.deepEqual(Object.keys(readState(fresh, 12, POLICY).stages), ['gate', 'ignored']);
  });

  it('uses the comments it is given instead of listing them again', () => {
    const gh = fakeGitHub();
    upsertStageComment(gh, 12, 'gate', 'body', {}, []);
    assert.deepEqual(
      gh.calls.map((c) => c.method),
      ['createComment']
    );
  });
});

describe('the gate comment (REQ-ISS-005, REQ-ISS-006, REQ-ISS-007)', () => {
  it('needs-detail: reasons, the rewrite in a fence that its text cannot close, next step', () => {
    const text = renderGateComment({
      verdict: 'needs-detail',
      reasons: ['Acceptance criteria: no Given/When/Then line'],
      rewrite: '## Story\n\n```\ncode\n```',
      judgment: 'not reached: the structural check failed',
      harness: 'claude',
    });
    assert.match(text, /needs-detail/);
    assert.match(text, /^- Acceptance criteria: no Given\/When\/Then line$/m);
    assert.match(text, /^````markdown\n## Story/m);
    assert.match(text, /Edit the issue/);
    assert.doesNotMatch(text, /fake harness/);
  });

  it('ready: verdict, size and its reasons, the next step; a fake run says so', () => {
    const text = renderGateComment({
      verdict: 'ready',
      reasons: [],
      size: 'simple',
      sizeReasons: ['names 1 file path (at most 5)'],
      judgment: 'ran',
      harness: 'fake',
      next: 'A maintainer comments `/plan`.',
    });
    assert.match(text, /\*\*Issue check: ready\*\*/);
    assert.match(text, /Size: \*\*simple\*\*/);
    assert.match(text, /^- names 1 file path \(at most 5\)$/m);
    assert.match(text, /fake harness/);
    assert.match(text, /A maintainer comments `\/plan`\./);
    assert.doesNotMatch(text, /Suggested issue body/);
  });
});
