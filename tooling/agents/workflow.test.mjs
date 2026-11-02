// Verifies: REQ-ISS-003, REQ-ISS-016, REQ-ISS-017, REQ-ISS-018, REQ-ISS-019
// Reads .github/workflows/agents.yml as text (no YAML dependency): the workflow keeps a plain
// two-space layout, and these helpers fail loudly when a job or key they look for moves.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { unpinnedActions } from '../supply-chain/supply-chain.mjs';
import { ROOT } from './test-helpers.mjs';

const YAML = readFileSync(join(ROOT, '.github/workflows/agents.yml'), 'utf8');
const LINES = YAML.split('\n');

/** The lines under `key:` at `indent` spaces, inside `lines`, up to the next sibling. */
function child(lines, key, indent) {
  const pad = ' '.repeat(indent);
  const start = lines.findIndex(
    (line) => line === `${pad}${key}:` || line.startsWith(`${pad}${key}: `)
  );
  assert.notEqual(start, -1, `no "${key}:" at indent ${indent}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(
    (line) => line.trim() && line.length - line.trimStart().length <= indent
  );
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))];
}
const job = (name) => child(child(LINES, 'jobs', 0), name, 2);
const keys = (lines, indent) =>
  lines.map((line) => new RegExp(`^ {${indent}}([\\w-]+):`).exec(line)?.[1]).filter(Boolean);
const text = (lines) => lines.join('\n');
/** One step of a job, by `id:` or `name:`, as its lines. */
function step(lines, match) {
  const starts = lines.flatMap((line, i) => (/^ {6}- /.test(line) ? [i] : []));
  const blocks = starts.map((start, n) => lines.slice(start, starts[n + 1] ?? lines.length));
  const found = blocks.find((b) => b.some((line) => match.test(line)));
  assert.ok(found, `no step matching ${match}`);
  return found;
}
/** A `run: |` block's script, dedented. */
function script(lines) {
  const at = lines.findIndex((line) => /^\s+run: \|$/.test(line));
  const body = lines.slice(at + 1).filter((line) => line.trim());
  const indent = Math.min(...body.map((line) => line.length - line.trimStart().length));
  return lines
    .slice(at + 1)
    .map((line) => line.slice(indent))
    .join('\n');
}

const ISSUE = job('issue');

describe('the issue job: triggers and serialization (REQ-ISS-003)', () => {
  it('listens to issues opened, edited, labeled and to new comments', () => {
    const on = child(LINES, 'on', 0);
    assert.match(text(child(on, 'issues', 2)), /^ {4}types: \[opened, edited, labeled\]$/m);
    assert.match(text(child(on, 'issue_comment', 2)), /^ {4}types: \[created\]$/m);
  });

  it('one run per issue at a time: newer queued runs replace older queued ones (REQ-ISS-003)', () => {
    const concurrency = text(child(ISSUE, 'concurrency', 4));
    const group = /group: (.+)$/m.exec(concurrency)?.[1] ?? '';
    assert.match(group, /\$\{\{ github\.repository \}\}/);
    assert.match(group, /\$\{\{ github\.event\.issue\.number \}\}/);
    assert.match(concurrency, /^ {6}cancel-in-progress: false$/m);
    assert.match(text(ISSUE), /^ {4}timeout-minutes: 60$/m);
  });

  it('skips bots, honours AGENTS_ENABLED and runs only on issue events (REQ-ISS-019)', () => {
    const condition = text(child(ISSUE, 'if', 4));
    assert.match(condition, /github\.event\.sender\.type != 'Bot'/);
    // The same form as the scheduled jobs, so `create-tran --agents github` flips every one.
    assert.match(condition, /vars\.AGENTS_ENABLED == 'true'/);
    assert.match(
      condition,
      /github\.event_name == 'issues' \|\| github\.event_name == 'issue_comment'/
    );
  });

  it('the other jobs ignore issue events', () => {
    for (const name of ['plan', 'guard', 'review'])
      assert.doesNotMatch(text(child(job(name), 'if', 4)), /issue/, name);
  });
});

describe('the issue job: identity and secrets (REQ-ISS-016, REQ-ISS-017)', () => {
  it('permissions are exactly contents, issues and pull requests write (REQ-ISS-016)', () => {
    const permissions = child(ISSUE, 'permissions', 4)
      .slice(1)
      .map((line) => line.trim());
    assert.deepEqual(permissions.sort(), [
      'contents: write',
      'issues: write',
      'pull-requests: write',
    ]);
    assert.match(YAML, /^permissions:\n {2}contents: read$/m);
  });

  it('the job sees the harness credential and the GitHub token, nothing else (REQ-ISS-017)', () => {
    const env = child(ISSUE, 'env', 4);
    assert.deepEqual(keys(env, 6), [
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'GH_TOKEN',
      'AGENT_HARNESS',
    ]);
    assert.match(text(env), /GH_TOKEN: \$\{\{ secrets\.AGENT_GITHUB_TOKEN \|\| github\.token \}\}/);
    assert.match(text(env), /AGENT_HARNESS: \$\{\{ vars\.AGENT_HARNESS \}\}/);
    const secrets = [...text(ISSUE).matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(secrets)].sort(), [
      'AGENT_GITHUB_TOKEN',
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ]);
    assert.doesNotMatch(text(ISSUE), /secrets: inherit|toJSON\(secrets\)/);
  });

  it('every action is pinned to a commit', () => {
    assert.deepEqual(unpinnedActions(YAML), []);
  });
});

describe('the issue job: without a credential (REQ-ISS-016, REQ-ISS-018)', () => {
  const check = step(ISSUE, /id: key/);
  const run = (env) => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-yml-'));
    const files = { GITHUB_ENV: join(dir, 'env'), GITHUB_OUTPUT: join(dir, 'output') };
    for (const file of Object.values(files)) writeFileSync(file, '');
    const result = spawnSync('bash', ['-e', '-c', script(check)], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        AGENT_HARNESS: '',
        ANTHROPIC_API_KEY: '',
        CLAUDE_CODE_OAUTH_TOKEN: '',
        ...files,
        ...env,
      },
    });
    return {
      status: result.status,
      stdout: result.stdout,
      env: readFileSync(files.GITHUB_ENV, 'utf8'),
      output: readFileSync(files.GITHUB_OUTPUT, 'utf8'),
    };
  };

  it('tests both credentials in one expression', () => {
    assert.match(script(check), /-z "\$ANTHROPIC_API_KEY\$CLAUDE_CODE_OAUTH_TOKEN"/);
  });

  it('no credential: model stages skip with a notice, the job goes on (REQ-ISS-016)', () => {
    for (const harness of ['claude', '']) {
      const result = run({ AGENT_HARNESS: harness });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /^::notice::.*model stages are skipped/m);
      assert.equal(result.env, 'AGENT_MODEL_STAGES=skip\n');
      assert.match(result.output, /^harness=claude$/m);
      assert.match(result.output, /^model=no$/m);
    }
  });

  it('either credential runs the model stages', () => {
    for (const env of [{ ANTHROPIC_API_KEY: 'k' }, { CLAUDE_CODE_OAUTH_TOKEN: 't' }]) {
      const result = run({ AGENT_HARNESS: 'claude', ...env });
      assert.equal(result.env, '');
      assert.match(result.output, /^model=yes$/m);
    }
  });

  it('AGENT_HARNESS=fake needs no credential (REQ-ISS-018); other harnesses skip', () => {
    const fake = run({ AGENT_HARNESS: 'fake' });
    assert.equal(fake.env, '');
    assert.match(fake.output, /^harness=fake$/m);
    assert.match(fake.output, /^model=yes$/m);
    const codex = run({ AGENT_HARNESS: 'codex', ANTHROPIC_API_KEY: 'k' });
    assert.equal(codex.env, 'AGENT_MODEL_STAGES=skip\n');
    assert.match(codex.stdout, /::notice::.*claude or fake/);
  });

  it('installs Claude Code only when a claude model stage will run, then runs the command', () => {
    const install = text(step(ISSUE, /claude-code@/));
    assert.match(install, /steps\.key\.outputs\.model == 'yes'/);
    assert.match(install, /steps\.key\.outputs\.harness == 'claude'/);
    const command = text(step(ISSUE, /agents\.mjs issue/));
    assert.match(command, /agents\.mjs issue --event "\$GITHUB_EVENT_PATH" --harness "\$HARNESS"/);
    assert.match(command, /HARNESS: \$\{\{ steps\.key\.outputs\.harness \}\}/);
    assert.doesNotMatch(text(ISSUE), /rust-toolchain|pnpm install/);
  });
});

describe('the review job accepts either Claude credential (REQ-ISS-016)', () => {
  it('reads both secrets and skips only when both are empty', () => {
    const review = job('review');
    assert.deepEqual(keys(child(review, 'env', 4), 6), [
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ]);
    assert.match(
      text(step(review, /id: key/)),
      /-z "\$ANTHROPIC_API_KEY\$CLAUDE_CODE_OAUTH_TOKEN"/
    );
  });
});
