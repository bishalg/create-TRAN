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
  fs.writeFileSync(
    path.join(fixture, 'Cargo.toml'),
    '[workspace]\nmembers = ["crates/rust-core", "crates/tran-uniffi"]\n'
  );
  fs.writeFileSync(path.join(fixture, 'README.md'), '# TRAN Template\nUse @tran/core\n');
  fs.mkdirSync(path.join(fixture, 'apps', 'native'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'apps', 'native', 'package.json'), '{"name":"native"}\n');
  fs.mkdirSync(path.join(fixture, 'apps', 'ios', 'Sources', 'TranVotingDemo'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(fixture, 'apps', 'ios', 'Sources', 'TranVotingDemo', 'App.swift'),
    'struct TranApp {}\n'
  );
  fs.mkdirSync(
    path.join(fixture, 'apps', 'android', 'app', 'src', 'main', 'kotlin', 'com', 'tran', 'voting'),
    {
      recursive: true,
    }
  );
  fs.writeFileSync(
    path.join(
      fixture,
      'apps',
      'android',
      'app',
      'src',
      'main',
      'kotlin',
      'com',
      'tran',
      'voting',
      'Main.kt'
    ),
    'package com.tran.voting\n'
  );
  fs.mkdirSync(path.join(fixture, 'crates', 'rust-core', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'crates', 'rust-core', 'src', 'tokens.rs'),
    [
      'pub const DEFAULT_THEME: &str = "dark";',
      'primary: hex("#0284c7"),',
      'primary_glow: "rgba(2, 132, 199, 0.25)".into(),',
      'primary: hex("#38bdf8"),',
      'primary_glow: "rgba(56, 189, 248, 0.35)".into(),',
    ].join('\n')
  );
  fs.mkdirSync(path.join(fixture, 'locales', 'en'), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'locales', 'en', 'common.json'),
    JSON.stringify({ brand: 'TRAN', appName: 'TRAN Voting' }, null, 2)
  );
  fs.mkdirSync(path.join(fixture, 'tooling', 'design-tokens'), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'tooling', 'design-tokens', 'codegen.json'),
    JSON.stringify(
      {
        ios_generated_dir: 'apps/ios/Sources/TranVotingDemo/Generated',
        android_kotlin_package: 'com.tran.voting.generated',
        android_app_package: 'com.tran.voting',
      },
      null,
      2
    )
  );
  fs.mkdirSync(path.join(fixture, 'packages', 'create-tran'), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'packages', 'create-tran', 'package.json'),
    '{"name":"create-tran"}\n'
  );

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
    const args = ['my-app', '--pm', 'pnpm', '--no-git', '--no-native', '--yes'];
    const parsed = parseArgs(args);

    expect(parsed.projectName).toBe('my-app');
    expect(parsed.packageManager).toBe('pnpm');
    expect(parsed.initGit).toBe(false);
    expect(parsed.includeNative).toBe(false);
    expect(parsed.skipPrompts).toBe(true);
  });

  it('should parse prefix, primary color, theme, and display name', () => {
    const parsed = parseArgs([
      'shop',
      '--prefix',
      'acme',
      '--primary',
      '#0ea5e9',
      '--theme',
      'light',
      '--display-name',
      'Acme Shop',
    ]);
    expect(parsed.projectName).toBe('shop');
    expect(parsed.stem).toBe('acme');
    expect(parsed.primaryColor).toBe('#0ea5e9');
    expect(parsed.defaultTheme).toBe('light');
    expect(parsed.displayName).toBe('Acme Shop');
  });

  it('should parse help, version, and template flags', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs(['--template', '/tmp/template']).templateUrl).toBe('/tmp/template');
  });

  it('should reject invalid prefix', () => {
    expect(() => parseArgs(['--prefix', 'x'])).toThrow(/2–12/);
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
      stem: 'tran',
      defaultTheme: 'dark',
      displayName: 'Test App',
      skipPrompts: true,
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

  it('should rewrite code prefix, paths, and primary color', async () => {
    const fixture = createLocalTemplateFixture();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tran-test-'));
    const targetDir = path.join(tmpDir, 'shop');

    await generateTranProject({
      projectName: 'shop',
      targetDir,
      packageManager: 'pnpm',
      includeNative: true,
      initGit: false,
      stem: 'acme',
      primaryColor: '#0ea5e9',
      defaultTheme: 'light',
      displayName: 'Acme Shop',
      skipPrompts: true,
      templateUrl: fixture,
    });

    const readme = fs.readFileSync(path.join(targetDir, 'README.md'), 'utf-8');
    expect(readme).toContain('@acme/core');

    const cargo = fs.readFileSync(path.join(targetDir, 'Cargo.toml'), 'utf-8');
    expect(cargo).toContain('crates/acme-uniffi');

    expect(
      fs.existsSync(path.join(targetDir, 'apps', 'ios', 'Sources', 'AcmeVotingDemo', 'App.swift'))
    ).toBe(true);
    const swift = fs.readFileSync(
      path.join(targetDir, 'apps', 'ios', 'Sources', 'AcmeVotingDemo', 'App.swift'),
      'utf-8'
    );
    expect(swift).toContain('struct AcmeApp');

    expect(
      fs.existsSync(
        path.join(
          targetDir,
          'apps',
          'android',
          'app',
          'src',
          'main',
          'kotlin',
          'com',
          'acme',
          'voting',
          'Main.kt'
        )
      )
    ).toBe(true);

    expect(fs.existsSync(path.join(targetDir, 'packages', 'create-acme'))).toBe(true);

    const tokens = fs.readFileSync(
      path.join(targetDir, 'crates', 'rust-core', 'src', 'tokens.rs'),
      'utf-8'
    );
    expect(tokens).toContain('#0ea5e9');
    expect(tokens).not.toContain('#0284c7');
    expect(tokens).toContain('pub const DEFAULT_THEME: &str = "light";');

    const common = JSON.parse(
      fs.readFileSync(path.join(targetDir, 'locales', 'en', 'common.json'), 'utf-8')
    );
    expect(common.appName).toBe('Acme Shop');
    expect(common.brand).toBe('Acme Shop');

    const codegen = JSON.parse(
      fs.readFileSync(path.join(targetDir, 'tooling', 'design-tokens', 'codegen.json'), 'utf-8')
    );
    expect(codegen.ios_generated_dir).toContain('AcmeVotingDemo');
    expect(codegen.android_app_package).toBe('com.acme.voting');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  });
});
