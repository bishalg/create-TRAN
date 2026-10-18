import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs } from '../src/utils.js';
import { TRAN_BANNER } from '../src/banner.js';
import { generateTranProject } from '../src/generator.js';

describe('CLI argument parsing', () => {
  it('should parse project name and flags', () => {
    const args = ['my-app', '--pm', 'pnpm', '--no-git', '--no-native'];
    const parsed = parseArgs(args);

    expect(parsed.projectName).toBe('my-app');
    expect(parsed.packageManager).toBe('pnpm');
    expect(parsed.initGit).toBe(false);
    expect(parsed.includeNative).toBe(false);
  });

  it('should parse help and version flags', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });
});

describe('TRAN Banner', () => {
  it('should contain TRAN letters and description', () => {
    expect(TRAN_BANNER).toContain('TanStack Start · Rust Core · Axum · Native');
  });
});

describe('Project Generator', () => {
  it('should scaffold project files into destination', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tran-test-'));
    const targetDir = path.join(tmpDir, 'test-app');

    await generateTranProject({
      projectName: 'test-app',
      targetDir,
      packageManager: 'pnpm',
      includeNative: true,
      initGit: false,
    });

    expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'Cargo.toml'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'nx.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'README.md'))).toBe(true);

    const pkgJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
    expect(pkgJson.name).toBe('test-app');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
