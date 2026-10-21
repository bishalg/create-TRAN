// Verifies: REQ-GEN-005
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_PATHS,
  AGENT_REFERENCES,
  applyAgentSetup,
  describeAgentSetup,
  validateAgentHarness,
  validateAgentSetup,
} from '../src/agents.js';
import { agentNextSteps } from '../src/cli.js';
import { parseArgs } from '../src/utils.js';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const dirs: string[] = [];

/** The files the agent setup touches, copied from this repository, so the edits are tested against
 * the real text rather than a fixture that cannot drift with it. */
function copyAgentFiles(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tran-agents-'));
  dirs.push(root);
  for (const relative of AGENT_PATHS) {
    fs.cpSync(path.join(repoRoot, relative), path.join(root, relative), { recursive: true });
  }
  return root;
}

const read = (root: string, relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const policy = (root: string) => JSON.parse(read(root, '.agents/policy.json'));

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// A project created with `--agents none` keeps this scaffolder but not the files it edits.
const hasAgentSetup = fs.existsSync(path.join(repoRoot, '.agents/policy.json'));

describe.skipIf(!hasAgentSetup)('agent setup (REQ-GEN-005)', () => {
  it('sample keeps the template files and only records the harness', () => {
    const root = copyAgentFiles();
    expect(applyAgentSetup(root, 'sample', 'pi')).toEqual([]);
    expect(policy(root).defaultHarness).toBe('pi');
    expect(read(root, '.github/workflows/agents.yml')).toBe(
      read(repoRoot, '.github/workflows/agents.yml')
    );
  });

  it('github turns the schedules on, with AGENTS_ENABLED=false as the off switch', () => {
    const root = copyAgentFiles();
    expect(applyAgentSetup(root, 'github', 'codex')).toEqual([]);
    const workflow = read(root, '.github/workflows/agents.yml');
    expect(workflow).toContain("vars.AGENTS_ENABLED != 'false'");
    expect(workflow).not.toContain("vars.AGENTS_ENABLED == 'true'");
    expect(read(root, '.agents/README.md')).toContain('Scheduled on GitHub Actions');
    expect(policy(root).defaultHarness).toBe('codex');
  });

  it('none removes the runner, tasks and workflow and leaves no reference to them', () => {
    const root = copyAgentFiles();
    expect(applyAgentSetup(root, 'none', 'claude')).toEqual([]);
    for (const gone of ['.agents/tasks', 'tooling/agents', '.github/workflows/agents.yml']) {
      expect({ gone, exists: fs.existsSync(path.join(root, gone)) }).toEqual({
        gone,
        exists: false,
      });
    }
    expect(fs.existsSync(path.join(root, '.agents/skills'))).toBe(true);
    const pkg = JSON.parse(read(root, 'package.json'));
    expect(pkg.scripts.agents).toBeUndefined();
    expect(pkg.scripts['agents:check']).toBeUndefined();
    expect(pkg.scripts['check:quick']).not.toContain('agents');
    const leftovers = AGENT_PATHS.filter((p) => fs.existsSync(path.join(root, p)))
      .filter((p) => fs.statSync(path.join(root, p)).isFile())
      .flatMap((p) =>
        AGENT_REFERENCES.filter((ref) => read(root, p).includes(ref)).map((ref) => `${p}: ${ref}`)
      );
    expect(leftovers).toEqual([]);
  });

  it('reports an edit whose text is no longer in the template instead of failing silently', () => {
    const root = copyAgentFiles();
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Rules\n');
    expect(applyAgentSetup(root, 'none', 'claude')).toEqual([
      'AGENTS.md: section "## Unattended agents" not found',
    ]);
  });
});

describe('agent setup options (REQ-GEN-005)', () => {
  it('describes each setup for the summary', () => {
    expect(describeAgentSetup('sample', 'claude')).toBe(
      'Sample in .agents/ (idle), harness claude'
    );
    expect(describeAgentSetup('github', 'gemini')).toBe(
      'Scheduled on GitHub Actions, harness gemini'
    );
    expect(describeAgentSetup('none', 'claude')).toBe('None');
  });

  it('prints next steps for the chosen setup, with the harness’s secret for GitHub', () => {
    expect(agentNextSteps({ agentSetup: 'none', packageManager: 'pnpm' })).toEqual([]);
    const sample = agentNextSteps({ agentSetup: 'sample', packageManager: 'npm' }).join('\n');
    expect(sample).toContain('default harness claude');
    expect(sample).toContain('npm run agents -- run code-review --dry-run');
    expect(sample).not.toContain('gh secret');
    const github = agentNextSteps({
      agentSetup: 'github',
      agentHarness: 'gemini',
      packageManager: 'pnpm',
    }).join('\n');
    expect(github).toContain('pnpm agents list');
    expect(github).toContain('gh secret set GEMINI_API_KEY');
    expect(github).toContain('gh variable set AGENTS_ENABLED --body false');
  });

  it('validates setups and harnesses, and parses the flags', () => {
    expect(validateAgentSetup('github')).toBe('github');
    expect(validateAgentSetup('jules')).toBeUndefined();
    expect(validateAgentHarness('pi', 'sample')).toBe('pi');
    // GitHub Actions installs only the three harnesses with a pinned CLI.
    expect(validateAgentHarness('pi', 'github')).toBeUndefined();
    expect(parseArgs(['app', '--agents', 'github', '--agent-harness', 'codex'])).toMatchObject({
      agentSetup: 'github',
      agentHarness: 'codex',
    });
    expect(parseArgs(['app', '--no-agents']).agentSetup).toBe('none');
    expect(() => parseArgs(['--agents', 'cloud'])).toThrow(/--agents/);
    expect(() => parseArgs(['--agent-harness', 'copilot'])).toThrow(/--agent-harness/);
  });
});
