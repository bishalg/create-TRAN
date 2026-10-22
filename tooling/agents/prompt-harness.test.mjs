// Verifies: REQ-AGT-004, REQ-AGT-005
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPrompt, harnessCommand, HARNESSES, repoSlug, runTask } from './agents.mjs';
import { POLICY, task, edited, REVIEW, fakeIo, OPTS } from './test-helpers.mjs';

describe('prompt (REQ-AGT-004)', () => {
  const signal = { status: 1, evidence: 'REQ-X-2 [planned] Next' };

  it('states mode, scope, protected paths, budget, gates, evidence, hand-off and the repo rules', () => {
    const prompt = buildPrompt({
      task: edited({
        'max_changed_lines: 50':
          "max_changed_lines: 50\nallow: ['**/generated/']\nskills: [ios-production]",
      }),
      policy: POLICY,
      rules: '# Rules\nBe exact.',
      signal,
    });
    for (const expected of [
      '# Agent task: spec-gap',
      '**Mode: edit.** Change only paths under: `docs/specs/`, `crates/`.',
      'Never change: `AGENTS.md`',
      'except `**/generated/`',
      'At most 50 changed lines',
      'gates run after you',
      '`pnpm test`, `cargo fmt --all -- --check`',
      '`.agents/skills/ios-production/SKILL.md`',
      '## Evidence: `planned-requirements` exited 1',
      'REQ-X-2 [planned] Next',
      '`.agents/out/spec-gap/result.md`',
      'NO-CHANGE',
      'Doing nothing is a correct',
      'Never weaken, skip or delete a test',
      '# Rules\nBe exact.',
    ])
      assert.ok(prompt.includes(expected), `prompt is missing: ${expected}`);
  });

  it('a read-only prompt forbids changes and asks for the report itself', () => {
    const prompt = buildPrompt({ task: REVIEW, policy: POLICY, rules: '', signal });
    assert.match(prompt, /\*\*Mode: read-only\.\*\* Do not create, change or delete any file/);
    assert.match(prompt, /Reply with the report/);
    assert.doesNotMatch(prompt, /result\.md/);
  });

  it('is the same text whichever harness runs it', () => {
    const io = fakeIo();
    const prompts = HARNESSES.filter((h) => h !== 'jules' && h !== 'custom').map((harness) => {
      runTask(task(), { ...OPTS, harness, dryRun: true }, io);
      return io.files['.agents/out/spec-gap/prompt.md'];
    });
    assert.equal(new Set(prompts).size, 1);
  });
});

describe('harness adapters (REQ-AGT-005)', () => {
  const base = { promptFile: '.agents/out/t/prompt.md', repo: 'o/r', custom: 'my-agent --stdin' };

  it('read-only tasks use each harness’s own read-only setting', () => {
    assert.deepEqual(harnessCommand('claude', { ...base, readOnly: true }).args, [
      '-p',
      '--disallowedTools',
      'Edit',
      'Write',
      'NotebookEdit',
      'Bash',
    ]);
    assert.deepEqual(harnessCommand('codex', { ...base, readOnly: true }).args, [
      'exec',
      '--sandbox',
      'read-only',
      '-',
    ]);
    assert.ok(
      harnessCommand('gemini', { ...base, readOnly: true })
        .args.join(' ')
        .includes('--approval-mode plan')
    );
    assert.ok(
      harnessCommand('pi', { ...base, readOnly: true })
        .args.join(' ')
        .includes('--tools read')
    );
  });

  it('edit tasks may edit and build, but never get git write access', () => {
    const claude = harnessCommand('claude', { ...base, readOnly: false });
    assert.ok(claude.args.includes('acceptEdits'));
    assert.ok(claude.args.includes('Bash(pnpm:*)'));
    assert.ok(!claude.args.some((arg) => /git (commit|push)/.test(arg)));
    assert.deepEqual(harnessCommand('codex', { ...base, readOnly: false }).args, [
      'exec',
      '--sandbox',
      'workspace-write',
      '-',
    ]);
    assert.ok(harnessCommand('gemini', { ...base, readOnly: false }).args.includes('auto_edit'));
  });

  it('passes the prompt the way each harness reads it, plus extra arguments', () => {
    assert.equal(harnessCommand('claude', base).stdin, true);
    const pi = harnessCommand('pi', { ...base, extraArgs: ['--model', 'x'] });
    assert.equal(pi.stdin, false);
    assert.ok(pi.args.includes('@.agents/out/t/prompt.md'));
    assert.ok(pi.args.includes('--model'));
    assert.deepEqual(harnessCommand('custom', base), {
      command: 'sh',
      args: ['-c', 'my-agent --stdin'],
      stdin: true,
    });
    assert.deepEqual(harnessCommand('jules', base), {
      command: 'jules',
      args: ['remote', 'new', '--repo', 'o/r'],
      stdin: true,
      async: true,
    });
  });

  it('fails clearly on a missing setting or an unknown harness', () => {
    assert.throws(() => harnessCommand('jules', { ...base, repo: null }), /AGENT_REPO/);
    assert.throws(
      () => harnessCommand('custom', { ...base, custom: undefined }),
      /AGENT_CMD is not set/
    );
    assert.throws(() => harnessCommand('copilot', base), /unknown harness "copilot"/);
  });

  it('reads the GitHub repository from an origin URL', () => {
    assert.equal(repoSlug('git@github.com:bishalg/create-TRAN.git'), 'bishalg/create-TRAN');
    assert.equal(repoSlug('https://github.com/bishalg/create-TRAN\n'), 'bishalg/create-TRAN');
    assert.equal(repoSlug('https://gitlab.com/x/y.git'), null);
  });
});
