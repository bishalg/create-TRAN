// Verifies: REQ-NAT-010
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

/** Directories that own their own primitives: the atom layers and generated code. */
const IOS_SKIP = /^(Atoms|Generated)$/;
const ANDROID_SKIP = /^(atoms|generated|uniffi)$/;

function listFiles(dir: string, extension: string, skip: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return skip.test(entry.name) ? [] : listFiles(full, extension, skip);
    }
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

const IOS_ATOMS = 'apps/ios/Sources/TranVotingDemo/Atoms';
const ANDROID_ATOMS = 'apps/android/app/src/main/kotlin/com/tran/voting/ui/atoms';

/**
 * Raw UI primitives that must live inside the atom layer: a regex guard over feature code,
 * deliberately not a type checker (see ADR-0022). Atoms compose these internally.
 */
const FORBIDDEN: Record<string, RegExp> = {
  swift: /\b(Text|Button|TextField|Picker|Divider)\(/,
  kotlin:
    /\b(Text|Button|TextButton|OutlinedButton|TextField|OutlinedTextField|FilterChip|Surface|Divider|HorizontalDivider)\(/,
};

function violations(dir: string, extension: string, pattern: RegExp, skip: RegExp): string[] {
  return listFiles(path.join(root, dir), extension, skip).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !line.trim().startsWith('//') && pattern.test(line))
      .map(({ line, index }) => `${path.relative(root, file)}:${index + 1}: ${line.trim()}`)
  );
}

describe('native UI atoms', () => {
  it('keeps raw UI primitives inside the atoms layer', () => {
    expect(violations('apps/ios/Sources', '.swift', FORBIDDEN.swift, IOS_SKIP)).toEqual([]);
    expect(
      violations('apps/android/app/src/main/kotlin', '.kt', FORBIDDEN.kotlin, ANDROID_SKIP)
    ).toEqual([]);
  });

  it('exposes the same atom names on both platforms', () => {
    const ios = listFiles(path.join(root, IOS_ATOMS), '.swift', /^$/);
    const android = listFiles(path.join(root, ANDROID_ATOMS), '.kt', /^$/);

    const basenames = (files: string[]): string[] =>
      files.map((file) => path.basename(file).replace(/\.(swift|kt)$/, '')).sort();
    expect(basenames(ios)).toEqual(basenames(android));

    const read = (files: string[]): string =>
      files.map((file) => readFileSync(file, 'utf8')).join('\n');
    const iosSource = read(ios);
    const androidSource = read(android);

    for (const name of [
      'TranScreen',
      'TranText',
      'TranStack',
      'TranInline',
      'TranBox',
      'TranSurface',
      'TranButton',
      'TranField',
      'TranSegmented',
      'TranDivider',
    ]) {
      expect(iosSource).toMatch(new RegExp(`struct ${name}\\b`));
      expect(androidSource).toMatch(new RegExp(`fun (?:<[^>]+> )?${name}\\b`));
    }
    expect(iosSource).toMatch(/enum TranGap\b/);
    expect(androidSource).toMatch(/enum class TranGap\b/);
  });

  it('exposes the same gap vocabulary as the generated space scale', () => {
    const tokens = JSON.parse(
      readFileSync(path.join(root, 'packages/core-ts/src/generated/tokens.json'), 'utf8')
    ) as { spacing: Record<string, string> };
    // `touch` is a minimum-target role and `nudge` a motion offset — neither is a gap step.
    const expected = Object.keys(tokens.spacing)
      .filter((name) => name !== 'touch' && name !== 'nudge')
      .map((name) => (name === '2xl' ? 'xxl' : name));
    expect(expected).toEqual(['xxs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', 'xxl']);

    const swift = readFileSync(path.join(root, IOS_ATOMS, 'TranGap.swift'), 'utf8');
    const kotlin = readFileSync(path.join(root, ANDROID_ATOMS, 'TranGap.kt'), 'utf8');

    expect([...swift.matchAll(/case (\w+)/g)].map((match) => match[1])).toEqual(expected);
    expect([...kotlin.matchAll(/([A-Z]+)\(TranSpace\.(\w+)\)/g)].map((match) => match[2])).toEqual(
      expected
    );

    for (const name of expected) {
      expect(swift).toContain(`case .${name}: return TranSpace.${name}`);
      expect(kotlin).toContain(`${name.toUpperCase()}(TranSpace.${name})`);
    }
  });
});
