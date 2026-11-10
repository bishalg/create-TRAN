// Verifies: REQ-MOB-010
// What App Store Connect and Google Play reject after an upload, checked before one (ADR-0042).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

const MANIFEST = 'apps/ios/Support/PrivacyInfo.xcprivacy';
const SWIFT_SOURCES = 'apps/ios/Sources';

/**
 * The API level Google Play requires new apps and app updates to target: Android 16, API 36, since
 * 2026-08-31 (developer.android.com/google/play/requirements/target-sdk, checked 2026-11-10). Google
 * raises it every August; bump this number, then `targetSdk` in apps/android/app/build.gradle.kts.
 */
const PLAY_REQUIRED_TARGET_SDK = 36;

interface Category {
  /** Swift calls that use the category. */
  calls: RegExp;
  /** Reasons an app (not a third-party SDK) may declare. */
  reasons: string[];
}

/**
 * Apple's required-reason API categories, the Swift calls in each and the approved reason codes:
 * "Describing use of required reason API" and the NSPrivacyAccessedAPIType reference
 * (developer.apple.com/documentation/bundleresources), checked 2026-11-10.
 */
const REQUIRED_REASON_APIS: Record<string, Category> = {
  NSPrivacyAccessedAPICategoryUserDefaults: {
    calls: /\b(?:NS)?UserDefaults\b|@AppStorage\b/,
    reasons: ['CA92.1', '1C8F.1', 'AC6B.1'],
  },
  NSPrivacyAccessedAPICategoryFileTimestamp: {
    calls:
      /\.(?:creationDate|modificationDate|fileModificationDate|contentModificationDateKey|creationDateKey)\b|\b(?:f|l)?stat(?:at)?\(|\bf?getattrlist(?:bulk|at)?\(/,
    reasons: ['DDA9.1', 'C617.1', '3B52.1'],
  },
  NSPrivacyAccessedAPICategorySystemBootTime: {
    calls: /\bsystemUptime\b|\bmach_absolute_time\(/,
    reasons: ['35F9.1', '8FFB.1', '3D61.1'],
  },
  NSPrivacyAccessedAPICategoryDiskSpace: {
    calls:
      /\.(?:volumeAvailableCapacity\w*Key|volumeTotalCapacityKey|systemFreeSize|systemSize)\b|\bf?statv?fs\(/,
    reasons: ['85F4.1', 'E174.1', '7D9E.1', 'B728.1'],
  },
  NSPrivacyAccessedAPICategoryActiveKeyboards: {
    calls: /\bactiveInputModes\b/,
    reasons: ['3EC4.1', '54BD.1'],
  },
};

/**
 * Categories used by linked code rather than Swift source, so the source scan cannot see them.
 * Each needs the evidence: `nm -u` on the built app binary.
 */
const LINKED_CODE: Record<string, string> = {
  NSPrivacyAccessedAPICategoryFileTimestamp:
    'libtran_uniffi.a (the Rust standard library) makes the app import fstat (Release build)',
};

function read(relative: string): string {
  return readFileSync(path.join(root, relative), 'utf8');
}

function swiftFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return swiftFiles(full);
    return entry.name.endsWith('.swift') ? [full] : [];
  });
}

/** Swift line comments and block comments removed, so a comment naming an API is not a call. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

interface Declaration {
  category: string;
  reasons: string[];
}

/** The `NSPrivacyAccessedAPITypes` entries of a privacy manifest. */
function declarations(manifest: string): Declaration[] {
  const body =
    /<key>NSPrivacyAccessedAPITypes<\/key>\s*<array>([\s\S]*)<\/array>\s*<\/dict>\s*<\/plist>/.exec(
      manifest
    )?.[1];
  return [...(body ?? '').matchAll(/<dict>([\s\S]*?)<\/dict>/g)].map(([, entry]) => ({
    category:
      /<key>NSPrivacyAccessedAPIType<\/key>\s*<string>([^<]+)<\/string>/.exec(entry!)?.[1] ?? '',
    reasons: [
      ...(
        /<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(
          entry!
        )?.[1] ?? ''
      ).matchAll(/<string>([^<]+)<\/string>/g),
    ].map((match) => match[1]!),
  }));
}

/** Each category the sources call, with the first file that calls it. */
function usedCategories(sources: Map<string, string>): Map<string, string> {
  const used = new Map<string, string>();
  for (const [category, { calls }] of Object.entries(REQUIRED_REASON_APIS)) {
    for (const [file, source] of sources) {
      if (calls.test(withoutComments(source))) {
        used.set(category, file);
        break;
      }
    }
  }
  return used;
}

/** `category: file` for every category the sources call that the manifest does not declare. */
function undeclared(sources: Map<string, string>, manifest: string): string[] {
  const declared = new Set(declarations(manifest).map((entry) => entry.category));
  return [...usedCategories(sources)]
    .filter(([category]) => !declared.has(category))
    .map(([category, file]) => `${category}: ${file}`);
}

/** Boolean plist value of `key`, or undefined when the key is absent. */
function plistBoolean(plist: string, key: string): boolean | undefined {
  const value = new RegExp(`<key>${key}</key>\\s*<(true|false)/>`).exec(plist)?.[1];
  return value === undefined ? undefined : value === 'true';
}

const sources = new Map(
  swiftFiles(path.join(root, SWIFT_SOURCES)).map((file) => [
    path.relative(root, file),
    readFileSync(file, 'utf8'),
  ])
);
const manifest = read(MANIFEST);

describe('iOS privacy manifest (REQ-MOB-010)', () => {
  it('declares every required-reason API category the Swift sources call', () => {
    expect(
      undeclared(sources, manifest),
      `declare these in ${MANIFEST} with an approved reason`
    ).toEqual([]);
    // The app keeps its theme and first-launch flag in UserDefaults.
    expect(usedCategories(sources).has('NSPrivacyAccessedAPICategoryUserDefaults')).toBe(true);
  });

  it('fails when a called category is missing from the manifest', () => {
    const calls = new Map([['Sample.swift', 'let t = ProcessInfo.processInfo.systemUptime']]);
    expect(undeclared(calls, manifest)).toEqual([
      'NSPrivacyAccessedAPICategorySystemBootTime: Sample.swift',
    ]);
    const commented = new Map([['Sample.swift', '// systemUptime\n/* mach_absolute_time() */']]);
    expect(undeclared(commented, manifest)).toEqual([]);
    const withoutDefaults = manifest.replace('NSPrivacyAccessedAPICategoryUserDefaults', 'x');
    expect(undeclared(sources, withoutDefaults)[0]).toMatch(
      /^NSPrivacyAccessedAPICategoryUserDefaults: apps\/ios\/Sources\//
    );
  });

  it('declares exactly the categories in use, each with approved reasons', () => {
    const declared = declarations(manifest);
    const expected = new Set([...usedCategories(sources).keys(), ...Object.keys(LINKED_CODE)]);
    expect(declared.map((entry) => entry.category).sort()).toEqual([...expected].sort());
    for (const { category, reasons } of declared) {
      expect(reasons.length, category).toBeGreaterThan(0);
      for (const reason of reasons) {
        expect(REQUIRED_REASON_APIS[category]?.reasons, category).toContain(reason);
      }
    }
  });

  it('declares no tracking, no tracking domains and no collected data', () => {
    expect(plistBoolean(manifest, 'NSPrivacyTracking')).toBe(false);
    expect(manifest).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
    expect(plistBoolean(manifest.replace('<false/>', '<true/>'), 'NSPrivacyTracking')).toBe(true);
  });

  it('is copied into the app bundle by the XcodeGen project', () => {
    const project = read('apps/ios/project.yml');
    expect(project).toMatch(/- path: Support\/PrivacyInfo\.xcprivacy\n\s+buildPhase: resources/);
    expect(read('apps/ios/TranVotingDemo.xcodeproj/project.pbxproj')).toContain(
      'PrivacyInfo.xcprivacy in Resources'
    );
  });
});

describe('export compliance and Play target API (REQ-MOB-010)', () => {
  it('answers export compliance in Info.plist: no non-exempt encryption', () => {
    expect(read('apps/ios/project.yml')).toMatch(/^\s+ITSAppUsesNonExemptEncryption: false$/m);
    const plist = read('apps/ios/Support/Info.plist');
    expect(plistBoolean(plist, 'ITSAppUsesNonExemptEncryption')).toBe(false);
    expect(plistBoolean('<plist/>', 'ITSAppUsesNonExemptEncryption')).toBeUndefined();
  });

  it(`targets at least the API level Google Play requires (${PLAY_REQUIRED_TARGET_SDK})`, () => {
    const gradle = read('apps/android/app/build.gradle.kts');
    const targetSdk = Number(/^\s*targetSdk\s*=\s*(\d+)/m.exec(gradle)?.[1]);
    const compileSdk = Number(/^\s*compileSdk\s*=\s*(\d+)/m.exec(gradle)?.[1]);
    expect(targetSdk).toBeGreaterThanOrEqual(PLAY_REQUIRED_TARGET_SDK);
    expect(compileSdk).toBeGreaterThanOrEqual(targetSdk);
  });
});
