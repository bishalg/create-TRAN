import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs, PINNED_PNPM } from '../src/utils.js';
import { TRAN_BANNER } from '../src/banner.js';
import { generateTranProject } from '../src/generator.js';

function createLocalTemplateFixture(): string {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tran-template-'));
  fs.writeFileSync(
    path.join(fixture, 'package.json'),
    JSON.stringify(
      {
        name: 'create-tran-workspace',
        version: '0.1.0',
        private: true,
        packageManager: PINNED_PNPM,
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(fixture, 'Cargo.toml'), '[workspace]\nmembers = []\n');
  fs.writeFileSync(path.join(fixture, 'README.md'), '# TRAN Template\n');
  fs.mkdirSync(path.join(fixture, 'apps', 'native'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'apps', 'native', 'package.json'), '{"name":"native"}\n');

  execFileSync('git', ['init'], { cwd: fixture });
  execFileSync('git', ['add', '.'], { cwd: fixture });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=create-tran-test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'chore: fixture',
    ],
    { cwd: fixture }
  );

  return fixture;
}

describe('CLI argument parsing', () => {
  it('should parse project name and flags', () => {
    const args = ['my-app', '--pm', 'pnpm', '--no-git', '--no-native'];
    const parsed = parseArgs(args);

    expect(parsed.projectName).toBe('my-app');
    expect(parsed.packageManager).toBe('pnpm');
    expect(parsed.initGit).toBe(false);
    expect(parsed.includeNative).toBe(false);
  });

  it('should parse help, version, and template flags', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs(['--template', '/tmp/template']).templateUrl).toBe('/tmp/template');
  });
});

describe('TRAN Banner', () => {
  it('should contain TRAN letters and description', () => {
    expect(TRAN_BANNER).toContain('TanStack Start · Rust Core · Axum · Native');
  });
});

describe('Project Generator', () => {
  it('should clone the template and customize the project', async () => {
    const fixture = createLocalTemplateFixture();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tran-test-'));
    const targetDir = path.join(tmpDir, 'test-app');

    await generateTranProject({
      projectName: 'test-app',
      targetDir,
      packageManager: 'pnpm',
      includeNative: false,
      initGit: false,
      templateUrl: fixture,
    });

    expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'Cargo.toml'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'apps', 'native'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, '.git'))).toBe(false);

    const pkgJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
    expect(pkgJson.name).toBe('test-app');
    expect(pkgJson.packageManager).toBe(PINNED_PNPM);

    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  });
});
