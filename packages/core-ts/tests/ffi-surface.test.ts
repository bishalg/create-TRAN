// Verifies: REQ-FFI-001 REQ-FFI-002 REQ-FFI-003 REQ-FFI-004
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

const SWIFT_BINDINGS = 'apps/ios/Sources/TranVotingDemo/Generated/UniFFI/tran_uniffi.swift';
const KOTLIN_BINDINGS =
  'apps/android/app/src/main/kotlin/com/tran/voting/uniffi/uniffi/tran_uniffi/tran_uniffi.kt';
const RUST_SURFACE = 'crates/tran-uniffi/src/lib.rs';

function readText(...segments: string[]): string {
  return readFileSync(path.join(root, ...segments), 'utf8');
}

function listFiles(dir: string, extension: string, skip: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return skip.test(entry.name) ? [] : listFiles(full, extension, skip);
    }
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

const rust = readText(RUST_SURFACE);
const surface = rust.split('#[cfg(test)]')[0];
const swift = readText(SWIFT_BINDINGS);
const kotlin = readText(KOTLIN_BINDINGS);

const iosSources = listFiles(
  path.join(root, 'apps/ios/Sources/TranVotingDemo'),
  '.swift',
  /^Generated$/
)
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
const androidSources = listFiles(
  path.join(root, 'apps/android/app/src/main/kotlin'),
  '.kt',
  /^(uniffi|generated)$/
)
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

const exportedFunctions = [...surface.matchAll(/#\[uniffi::export\]\s*\n\s*pub fn (\w+)/g)];

const exportedTypes = [
  ...surface.matchAll(/#\[derive\(([^)]*)\)\]\s*\n\s*pub (struct|enum) (\w+)/g),
]
  .filter((match) => /uniffi::(Record|Enum|Error)/.test(match[1]))
  .map((match) => ({ kind: match[2], name: match[3], index: match.index! }));

function bodyOf(index: number): string {
  const start = surface.indexOf('{', index);
  const end = surface.indexOf('\n}', start);
  return surface.slice(start + 1, end);
}

function linesOf(text: string): string[] {
  return text.split('\n');
}

function expectDocBefore(index: number, label: string): void {
  const before = surface.slice(0, index).trimEnd().split('\n').at(-1) ?? '';
  expect(before.trim(), `${label} must have a rustdoc comment`).toMatch(/^\/\/\//);
}

function camelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

describe('native FFI surface', () => {
  it('documents every exported function and type in Rust and in both bindings', () => {
    expect(rust).toContain('#![deny(missing_docs)]');
    expect(exportedFunctions.length).toBeGreaterThan(0);
    expect(exportedTypes.length).toBeGreaterThanOrEqual(3);

    for (const match of exportedFunctions) {
      expectDocBefore(match.index!, match[1]);
    }

    for (const type of exportedTypes) {
      expectDocBefore(type.index, type.name);

      const body = bodyOf(type.index);
      const bodyLines = linesOf(body);
      const memberPattern = type.kind === 'struct' ? /^pub \w+:/ : /^[A-Z]\w*\s*,?$/;
      let members = 0;
      for (let index = 0; index < bodyLines.length; index += 1) {
        const line = bodyLines[index].trim();
        if (!memberPattern.test(line)) continue;
        members += 1;
        let previous = index - 1;
        while (
          previous >= 0 &&
          (bodyLines[previous].trim().startsWith('#[') || bodyLines[previous].trim() === '')
        ) {
          previous -= 1;
        }
        expect(
          bodyLines[previous]?.trim() ?? '',
          `${type.name} member \`${line}\` must have a rustdoc comment`
        ).toMatch(/^\/\/\//);
      }
      expect(members, `${type.name} should expose members`).toBeGreaterThan(0);
    }

    for (const match of exportedFunctions) {
      const name = match[1];
      const camel = camelCase(name);
      const swiftIndex = swift.indexOf(`public func ${camel}`);
      expect(swiftIndex, `${camel} must exist in Swift`).toBeGreaterThan(-1);
      expect(swift.lastIndexOf('/**', swiftIndex)).toBeGreaterThan(swiftIndex - 3000);

      const kotlinIndex = kotlin.indexOf(`fun \`${camel}\``);
      expect(kotlinIndex, `${camel} must exist in Kotlin`).toBeGreaterThan(-1);
      expect(kotlin.lastIndexOf('/**', kotlinIndex)).toBeGreaterThan(kotlinIndex - 3000);
    }

    for (const [swiftName, kotlinName] of [
      ['VoteEligibilityOfflineResult', 'VoteEligibilityOfflineResult'],
      ['TranEligibilityReason', 'TranEligibilityReason'],
      ['TranValidationError', 'TranValidationException'],
    ]) {
      const swiftIndex = swift.search(new RegExp(`public\\s+(?:struct|enum)\\s+${swiftName}\\b`));
      expect(swiftIndex, `${swiftName} must exist in Swift`).toBeGreaterThan(-1);
      expect(swift.lastIndexOf('/**', swiftIndex)).toBeGreaterThan(swiftIndex - 3000);

      const kotlinIndex = kotlin.search(
        new RegExp(`(?:data class|enum class|sealed class)\\s+${kotlinName}\\b`)
      );
      expect(kotlinIndex, `${kotlinName} must exist in Kotlin`).toBeGreaterThan(-1);
      expect(kotlin.lastIndexOf('/**', kotlinIndex)).toBeGreaterThan(kotlinIndex - 3000);
    }
  });

  it('uses domain enums instead of magic strings at the boundary', () => {
    expect(surface).toContain('pub enum TranEligibilityReason');
    expect(surface).toContain('pub enum TranValidationError');
    expect(surface).toContain('pub reason: TranEligibilityReason');
    expect(surface).not.toContain('pub reason: String');
    expect(surface).not.toContain('detail: String');

    expect(swift).toContain('public var reason: TranEligibilityReason');
    expect(kotlin).toContain('var `reason`: TranEligibilityReason');
    expect(swift).toContain('case InvalidCountryCode');
    expect(kotlin).toContain('class InvalidCountryCode');
    expect(kotlin).not.toContain('TranValidationException.ValidationException');

    expect(kotlin).toContain('uniffiCheckContractApiVersion');
    expect(kotlin).toContain('uniffiCheckApiChecksums');
    expect(swift).toContain('uniffiEnsureTranUniffiInitialized');
  });

  it('extends generated types instead of redeclaring them', () => {
    const generatedSwift = [...swift.matchAll(/public\s+(?:struct|enum|class|protocol)\s+(\w+)/g)]
      .map((match) => match[1])
      .filter((name) => !/^(FfiConverter|Uniffi|Rust|Foreign)/.test(name));
    const generatedKotlin = [
      ...kotlin.matchAll(
        /^(?:open |sealed |data |enum |abstract )*(?:class|interface|object)\s+(\w+)/gm
      ),
    ]
      .map((match) => match[1])
      .filter((name) => !/^(FfiConverter|Uniffi|Rust|Foreign)/.test(name));

    expect(generatedSwift.length).toBeGreaterThan(0);
    expect(generatedKotlin.length).toBeGreaterThan(0);

    for (const name of generatedSwift) {
      expect(iosSources, `iOS must not redeclare generated ${name}; extend it instead`).not.toMatch(
        new RegExp(`\\b(?:struct|class|enum|typealias)\\s+${name}\\b`)
      );
    }
    for (const name of generatedKotlin) {
      expect(
        androidSources,
        `Android must not redeclare generated ${name}; extend it instead`
      ).not.toMatch(
        new RegExp(
          `\\b(?:data class|sealed class|enum class|class|interface|typealias)\\s+${name}\\b`
        )
      );
    }

    expect(iosSources).toContain('extension VoteEligibilityOfflineResult');
    expect(iosSources).toContain('extension TranValidationError');
    expect(androidSources).toContain('fun VoteEligibilityOfflineResult.reasonRes');
    expect(androidSources).toContain('fun TranValidationException.localizedMessageRes');
  });
});
