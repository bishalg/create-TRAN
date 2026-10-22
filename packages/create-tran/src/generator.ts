import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  applyAgentSetup,
  DEFAULT_AGENT_HARNESS,
  DEFAULT_AGENT_SETUP,
  describeAgentSetup,
} from './agents.js';
import { customizeIdentity } from './customize.js';
import { DEFAULT_STEM } from './stem.js';
import {
  type CliOptions,
  DEFAULT_TEMPLATE_REPO,
  assertTargetAvailable,
  packageManagerField,
} from './utils.js';

function run(command: string, args: string[], cwd?: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

/** Returns the template edits that no longer matched (see `applyAgentSetup`). */
function customizeProject(options: CliOptions): string[] {
  // Before the identity rewrite, so the agent edits match the template's own text.
  const missed = applyAgentSetup(
    options.targetDir,
    options.agentSetup ?? DEFAULT_AGENT_SETUP,
    options.agentHarness ?? DEFAULT_AGENT_HARNESS
  );

  customizeIdentity(options.targetDir, {
    stem: options.stem,
    primaryColor: options.primaryColor,
    defaultTheme: options.defaultTheme,
    displayName: options.displayName,
  });

  const rootPkgPath = path.join(options.targetDir, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    const pkg = readJson(rootPkgPath);
    pkg.name = options.projectName;
    pkg.private = true;
    pkg.packageManager = packageManagerField(options.packageManager);
    writeJson(rootPkgPath, pkg);
  }

  if (!options.includeNative) {
    for (const app of ['native', 'ios', 'android']) {
      const appDir = path.join(options.targetDir, 'apps', app);
      if (fs.existsSync(appDir)) {
        fs.rmSync(appDir, { recursive: true, force: true });
      }
    }
  }

  // Drop local install artifacts if the template source was a working copy.
  for (const artifact of ['node_modules', 'target', 'dist']) {
    const artifactPath = path.join(options.targetDir, artifact);
    if (fs.existsSync(artifactPath)) {
      fs.rmSync(artifactPath, { recursive: true, force: true });
    }
  }
  return missed;
}

const FIRST_VERSION = '0.1.0';
const EMPTY_CHANGELOG =
  '# Changelog\n\nAll notable changes, newest first. Written by `pnpm release` from Conventional Commits.\n';

/**
 * A new project starts at 0.1.0 with an empty changelog, not the template's version and history
 * (REQ-REL-005). The template's own release tool writes the version, so every platform agrees.
 */
function resetReleaseHistory(options: CliOptions): void {
  const tool = path.join(options.targetDir, 'tooling', 'release', 'release.mjs');
  if (fs.existsSync(tool)) {
    execFileSync('node', [tool, 'set', FIRST_VERSION], { cwd: options.targetDir, stdio: 'pipe' });
  }
  const changelog = path.join(options.targetDir, 'CHANGELOG.md');
  if (fs.existsSync(changelog)) {
    fs.writeFileSync(changelog, EMPTY_CHANGELOG, 'utf-8');
  }
}

function resetGitHistory(options: CliOptions): void {
  const gitDir = path.join(options.targetDir, '.git');
  if (fs.existsSync(gitDir)) {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }

  if (!options.initGit) {
    return;
  }

  run('git', ['init'], options.targetDir);
  run('git', ['add', '.'], options.targetDir);
  run(
    'git',
    [
      '-c',
      'user.name=create-tran',
      '-c',
      'user.email=create-tran@users.noreply.github.com',
      'commit',
      '-m',
      'chore: initial commit from create-tran template',
    ],
    options.targetDir
  );
}

/**
 * Scaffold a TRAN project by cloning the GitHub template repository,
 * then applying name / prefix / colour customization.
 */
export async function generateTranProject(options: CliOptions): Promise<void> {
  assertTargetAvailable(options.targetDir);

  const templateUrl =
    options.templateUrl || process.env.CREATE_TRAN_TEMPLATE_URL || DEFAULT_TEMPLATE_REPO;

  const parent = path.dirname(options.targetDir);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  if (fs.existsSync(options.targetDir)) {
    fs.rmSync(options.targetDir, { recursive: true, force: true });
  }

  // Local path: copy the fixture/workdir instead of git-cloning a URL.
  if (fs.existsSync(templateUrl) && fs.statSync(templateUrl).isDirectory()) {
    fs.cpSync(templateUrl, options.targetDir, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        return base !== 'node_modules' && base !== 'target' && base !== 'dist';
      },
    });
  } else {
    run('git', ['clone', '--depth', '1', templateUrl, options.targetDir]);
  }

  for (const miss of customizeProject(options)) {
    process.stderr.write(`  ⚠ agent setup: ${miss}; please adjust it by hand\n`);
  }
  resetReleaseHistory(options);
  resetGitHistory(options);
}

export function describeCustomization(options: CliOptions): string[] {
  const color = options.primaryColorLabel || options.primaryColor || 'Template default (unchanged)';
  return [
    `  Project:         ${options.projectName}`,
    `  Display name:    ${options.displayName}`,
    `  Code prefix:     ${options.stem}${options.stem === DEFAULT_STEM ? ' (template default)' : ''}`,
    `  Primary color:   ${color}`,
    `  Default theme:   ${options.defaultTheme}`,
    `  Package manager: ${options.packageManager}`,
    `  Native mobile:   ${options.includeNative ? 'Included' : 'Skipped'}`,
    `  Coding agents:   ${describeAgentSetup(
      options.agentSetup ?? DEFAULT_AGENT_SETUP,
      options.agentHarness ?? DEFAULT_AGENT_HARNESS
    )}`,
    `  Git init:        ${options.initGit ? 'Yes' : 'No'}`,
  ];
}
