// Verifies: REQ-ROB-008
/**
 * Each platform logs through exactly one place, at the catalogue's level (ADR-0029). Anything else
 * — a stray `console.log`, `print`, `println` — is noise an agent or developer has to filter out.
 * Rust is held to the same rule by Clippy (`[workspace.lints.clippy]` in `Cargo.toml`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

const SKIP = new Set(['node_modules', 'dist', 'generated', 'Generated', 'uniffi', 'build']);

function listFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : listFiles(full, extensions);
    return extensions.some((ext) => entry.name.endsWith(ext)) ? [full] : [];
  });
}

/** `file:line: code` for every non-comment line matching `pattern` outside `allowed`. */
function offenders(dirs: string[], extensions: string[], pattern: RegExp, allowed: string[]) {
  return dirs
    .flatMap((dir) => listFiles(path.join(root, dir), extensions))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .filter((file) => !/\.test\.tsx?$/.test(file) && !allowed.includes(file))
    .flatMap((file) =>
      readFileSync(path.join(root, file), 'utf8')
        .split('\n')
        .map((line, i) => ({ line: line.trim(), at: `${file}:${i + 1}` }))
        .filter(({ line }) => !/^(\/\/|\/?\*)/.test(line) && pattern.test(line))
        .map(({ line, at }) => `${at}: ${line}`)
    );
}

describe('one logger per platform (REQ-ROB-008)', () => {
  it('TypeScript only reaches the console through logFailure', () => {
    expect(
      offenders(
        ['packages/core-ts/src', 'packages/api/src', 'apps/web/src'],
        ['.ts', '.tsx'],
        /\bconsole\b/,
        ['packages/core-ts/src/feedback.ts']
      )
    ).toEqual([]);
  });

  it('Swift only logs through os.Logger in TranFeedback', () => {
    expect(
      offenders(['apps/ios/Sources'], ['.swift'], /\b(print|debugPrint|dump|NSLog|os_log)\s*\(/, [])
    ).toEqual([]);
  });

  it('Kotlin only logs through TranFeedback', () => {
    expect(
      offenders(
        ['apps/android/app/src/main'],
        ['.kt'],
        /\bprintln?\s*\(|System\.(out|err)|android\.util\.Log|\bLog\.[dewiva]\(|printStackTrace/,
        ['apps/android/app/src/main/kotlin/com/tran/voting/ui/feedback/TranFeedback.kt']
      )
    ).toEqual([]);
  });

  it('the guard itself catches a stray call', () => {
    expect(/\bconsole\b/.test("console.log('x')")).toBe(true);
    expect(/\b(print|NSLog)\s*\(/.test('print("x")')).toBe(true);
  });
});
