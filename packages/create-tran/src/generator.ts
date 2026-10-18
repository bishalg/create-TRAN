import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
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

function customizeProject(options: CliOptions): void {
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
 * then renaming / trimming options for the new app.
 */
export async function generateTranProject(options: CliOptions): Promise<void> {
  assertTargetAvailable(options.targetDir);

  const templateUrl =
    options.templateUrl || process.env.CREATE_TRAN_TEMPLATE_URL || DEFAULT_TEMPLATE_REPO;

  const parent = path.dirname(options.targetDir);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  // Clone into a temp name if the destination exists as an empty dir,
  // otherwise clone directly into targetDir.
  if (fs.existsSync(options.targetDir)) {
    fs.rmSync(options.targetDir, { recursive: true, force: true });
  }

  run('git', ['clone', '--depth', '1', templateUrl, options.targetDir]);

  customizeProject(options);
  resetGitHistory(options);
}
