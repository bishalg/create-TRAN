// Verifies: REQ-GEN-004
/**
 * The generator tests above use a hand-made fixture, which cannot notice the real template moving
 * away from what the customizer expects (a renamed folder, a reformatted colour line). This one
 * scaffolds this repository's own files — tracked plus untracked-but-not-ignored, so work in
 * progress counts — and checks every customization landed.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTranProject } from '../src/generator.js';
import { applyStemRewrite, TEMPLATE_DARK_PRIMARY, TEMPLATE_LIGHT_PRIMARY } from '../src/stem.js';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const PRIMARY = '#16a34a';

let workDir: string;
let project: string;

/** Copies what `git` would ship from the working tree, ignoring build output. */
function copyWorkingTree(to: string): void {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  for (const relative of listed.split('\0')) {
    const from = path.join(repoRoot, relative);
    // A tracked file deleted in the working tree is listed but gone.
    if (!relative || !fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
    fs.mkdirSync(path.dirname(path.join(to, relative)), { recursive: true });
    fs.copyFileSync(from, path.join(to, relative));
  }
}

const read = (relative: string) => fs.readFileSync(path.join(project, relative), 'utf8');
const exists = (relative: string) => fs.existsSync(path.join(project, relative));

beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tran-smoke-'));
  const template = path.join(workDir, 'template');
  copyWorkingTree(template);
  project = path.join(workDir, 'acme-vote');
  await generateTranProject({
    projectName: 'acme-vote',
    targetDir: project,
    packageManager: 'pnpm',
    includeNative: true,
    initGit: false,
    stem: 'acme',
    primaryColor: PRIMARY,
    defaultTheme: 'light',
    displayName: 'Acme Vote',
    skipPrompts: true,
    templateUrl: template,
  });
}, 120_000);

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('scaffolding the real template (REQ-GEN-004)', () => {
  it('rebrands the Rust tokens: both template primaries replaced, default theme set', () => {
    const tokens = read('crates/rust-core/src/tokens.rs');
    expect(tokens).not.toContain(TEMPLATE_LIGHT_PRIMARY);
    expect(tokens).not.toContain(TEMPLATE_DARK_PRIMARY);
    expect(tokens).not.toMatch(/rgba\((56, 189, 248|2, 132, 199), /);
    expect(tokens).toContain(PRIMARY);
    expect(tokens).toContain('pub const DEFAULT_THEME: &str = "light";');
  });

  it('sets the display name in every locale', () => {
    for (const locale of fs.readdirSync(path.join(project, 'locales'))) {
      const common = JSON.parse(read(`locales/${locale}/common.json`));
      expect({ locale, brand: common.brand, appName: common.appName }).toEqual({
        locale,
        brand: 'Acme Vote',
        appName: 'Acme Vote',
      });
    }
  });

  it('renames the prefix in folders and package names', () => {
    for (const folder of [
      'crates/acme-uniffi',
      'crates/acme-tokens-codegen',
      'packages/create-acme',
      'apps/ios/Sources/AcmeVotingDemo',
      'apps/ios/Tests/AcmeVotingDemoTests',
      'apps/android/app/src/main/kotlin/com/acme/voting',
    ]) {
      expect({ folder, exists: exists(folder) }).toEqual({ folder, exists: true });
    }
    expect(exists('crates/tran-uniffi')).toBe(false);
    expect(exists('apps/ios/Sources/TranVotingDemo')).toBe(false);
    expect(JSON.parse(read('package.json')).name).toBe('acme-vote');
    expect(JSON.parse(read('packages/core-ts/package.json')).name).toBe('@acme/core');
  });

  it('renames files and folders by the same rules as their contents', () => {
    // Otherwise a reference rewritten to `build-acme-uniffi.sh` points at a file still named
    // `build-tran-uniffi.sh`.
    const stale: string[] = [];
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const relative = path.relative(project, path.join(dir, entry.name));
        if (applyStemRewrite(entry.name, 'acme') !== entry.name) stale.push(relative);
        if (entry.isDirectory()) visit(path.join(dir, entry.name));
      }
    };
    visit(project);
    expect(stale).toEqual([]);
    expect(exists('apps/ios/scripts/build-acme-uniffi.sh')).toBe(true);
    expect(read('apps/ios/project.yml')).toContain('build-acme-uniffi.sh');
  });

  it('leaves the codegen config pointing at folders that exist', () => {
    const config = JSON.parse(read('tooling/design-tokens/codegen.json')) as Record<string, string>;
    const folders = [
      'locales_dir',
      'core_generated_dir',
      'web_generated_dir',
      'ios_generated_dir',
      'android_kotlin_generated_dir',
      'android_res_dir',
    ].map((key) => `${key}: ${config[key]}`);
    expect(folders.filter((entry) => !exists(entry.split(': ')[1] ?? ''))).toEqual([]);
    expect(config.android_app_package).toBe('com.acme.voting');
  });

  it('leaves a Cargo workspace that cargo accepts, with renamed crates', () => {
    const metadata = JSON.parse(
      execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], {
        cwd: project,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
    ) as { packages: { name: string }[] };
    const names = metadata.packages.map((p) => p.name).sort();
    expect(names).toContain('acme-uniffi');
    expect(names).toContain('acme-tokens-codegen');
    expect(names.filter((name) => name.includes('tran'))).toEqual([]);
  });
});
