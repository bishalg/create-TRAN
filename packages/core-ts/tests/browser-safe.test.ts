// Verifies: REQ-CFG-006
// The web bundles @tran/core and @tran/api. Vite replaces a Node built-in with a stub that throws
// on first use, so one `import … from 'node:crypto'` in a reachable file breaks every page while
// unit tests (in Node) stay green. This guard fails first.
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

/** Every source the web bundle can reach: everything under `src/` of the libraries it imports. */
const BUNDLED = ['packages/core-ts/src', 'packages/api/src'];

function sources(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return sources(relative);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [relative] : [];
  });
}

const SPECIFIER =
  /\b(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/g;

/** Module specifiers imported by `source`. */
function specifiers(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4])!);
}

const builtins = new Set(builtinModules);
const isNodeBuiltin = (spec: string) => spec.startsWith('node:') || builtins.has(spec);

describe('no Node built-in in code the web bundles', () => {
  it('the scanner sees every import form', () => {
    const sample = `import { a } from 'node:crypto';
      export * from "fs";
      import 'node:path';
      const m = await import('node:os');
      const r = require('crypto');
      import type { X } from './local.js';`;
    expect(specifiers(sample).filter(isNodeBuiltin)).toEqual([
      'node:crypto',
      'fs',
      'node:path',
      'node:os',
      'crypto',
    ]);
  });

  it('no file under the bundled src folders imports one', () => {
    const files = BUNDLED.flatMap(sources);
    expect(files).toContain('packages/core-ts/src/flags.ts');
    const offenders = files.flatMap((file) =>
      specifiers(readFileSync(path.join(root, file), 'utf8'))
        .filter(isNodeBuiltin)
        .map((spec) => `${file}: ${spec}`)
    );
    expect(offenders).toEqual([]);
  });
});
