// Verifies: REQ-NAT-009
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

function listFiles(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return /^(Generated|generated|uniffi|build)$/.test(entry.name)
        ? []
        : listFiles(full, extension);
    }
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

/** Numeric layout/typography literals and raw colours that must come from `TranSpace`/`TranRadius`/palettes. */
const FORBIDDEN: Record<string, RegExp> = {
  swift:
    /spacing: ?\d|\.padding\(\d|minHeight: ?\d|cornerRadius\(?:? ?\d|\.system\(size|Color\(red|Color\.(red|blue|green|white|black)\b|Color\(tranHex|\.frame\([^)]*\b\d{2,}\b/,
  kotlin:
    /\b\d+(\.\d+)?\.(dp|sp)\b|Color\(0x|Color\.(Red|Blue|Green|White|Black)\b|RoundedCornerShape\(\d/,
};

function violations(dir: string, extension: string, pattern: RegExp): string[] {
  return listFiles(path.join(root, dir), extension).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !line.trim().startsWith('//') && pattern.test(line))
      .map(({ line, index }) => `${path.relative(root, file)}:${index + 1}: ${line.trim()}`)
  );
}

describe('native feature code uses generated tokens, not literals', () => {
  it('iOS screens use TranSpace/TranRadius and palettes', () => {
    expect(violations('apps/ios/Sources', '.swift', FORBIDDEN.swift)).toEqual([]);
  });

  it('Android screens use TranSpace/TranRadius and palettes', () => {
    expect(violations('apps/android/app/src/main/kotlin', '.kt', FORBIDDEN.kotlin)).toEqual([]);
  });

  it('exposes the same scale on both platforms as the Rust tokens', () => {
    const tokens = JSON.parse(
      readFileSync(path.join(root, 'packages/core-ts/src/generated/tokens.json'), 'utf8')
    ) as { spacing: Record<string, string> };
    const points = (value: string): number => parseFloat(value) * 16;
    const swift = readFileSync(
      path.join(root, 'apps/ios/Sources/TranVotingDemo/Generated/BrandTokens.swift'),
      'utf8'
    );
    const kotlin = readFileSync(
      path.join(root, 'apps/android/app/src/main/kotlin/com/tran/voting/generated/BrandTokens.kt'),
      'utf8'
    );

    for (const [name, member] of [
      ['md', 'md'],
      ['lg', 'lg'],
      ['touch', 'touch'],
      ['2xl', 'xxl'],
    ]) {
      expect(swift).toContain(`static let ${member}: CGFloat = ${points(tokens.spacing[name]!)}`);
      expect(kotlin).toContain(`val ${member}: Dp = ${points(tokens.spacing[name]!)}.dp`);
    }
  });
});
