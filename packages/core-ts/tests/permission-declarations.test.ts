// Verifies: REQ-PRV-003 REQ-PRV-005 REQ-PRV-006
// What the apps declare and who may ask the operating system, checked against the Rust permission
// catalogue (spec 026, ADR-0043). It reads native files, so it lives with the other guards here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../src/generated/rules.js';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

const ANDROID_MANIFEST = 'apps/android/app/src/main/AndroidManifest.xml';
const IOS_PROJECT = 'apps/ios/project.yml';
const IOS_INFO_PLIST = 'apps/ios/Support/Info.plist';
const IOS_INFO_PLIST_STRINGS = 'apps/ios/Sources/TranVotingDemo/Generated/InfoPlist.xcstrings';

/**
 * Permissions that never show a prompt, each with the reason the app declares it. Anything else
 * the manifest declares must be a catalogue entry (REQ-PRV-005).
 */
const NON_PROMPTING: Record<string, string> = {
  // The voter dashboard confirms verdicts with the API (REQ-NAT-011).
  'android.permission.INTERNET': 'network access for the API',
  // The offline banner recovers as soon as the network returns (REQ-ERR-013).
  'android.permission.ACCESS_NETWORK_STATE': 'hearing when the network returns',
};

/** More than any feature here needs: precise or background location (REQ-PRV-006). */
const NEVER_DECLARED = [
  /^android\.permission\.ACCESS_FINE_LOCATION$/,
  /^android\.permission\.ACCESS_BACKGROUND_LOCATION$/,
  /^NSLocationAlways\w*$/,
  /^NSLocationUsageDescription$/,
];

/**
 * The only files that may call the platform's permission and location APIs (REQ-PRV-003). The
 * iOS and Android permission packages create them; every other file goes through the gateway
 * protocol or interface, and tests use a fake.
 */
const PERMISSION_GATEWAYS = {
  ios: 'apps/ios/Sources/TranVotingDemo/Permissions/SystemPermissionGateway.swift',
  android:
    'apps/android/app/src/main/kotlin/com/tran/voting/permissions/SystemPermissionGateway.kt',
} as const;

/**
 * Calls that ask the system or read its answer; only a gateway may contain them. On iOS the
 * notification permission is `requestAuthorization` and the settings read, not the notification
 * center itself: the push gateway also uses the center, for its delegate (push-guards.test.ts).
 */
const PLATFORM_PERMISSION_APIS = {
  ios: /\bCLLocationManager\b|\brequest(?:WhenInUse|Always|TemporaryFullAccuracy)?Authorization\b|\b(?:get)?[nN]otificationSettings\b/,
  android:
    /\brequestPermissions\s*\(|\bActivityResultContracts\.Request(?:Multiple)?Permissions?\b|\b(?:check|request)SelfPermission\b|\bshouldShowRequestPermissionRationale\b|\bLocationManager\b/,
} as const;

function read(relative: string): string {
  return readFileSync(path.join(root, relative), 'utf8');
}

function files(dir: string, extension: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      return /^(Generated|generated|uniffi)$/.test(entry.name) ? [] : files(relative, extension);
    }
    return entry.name.endsWith(extension) ? [relative] : [];
  });
}

/** Line, block, XML and YAML comments removed, so a comment naming a key is not one. */
function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .replace(/(^|\s)#.*$/gm, '$1');
}

/** `uses-permission` (and `uses-permission-sdk-23`) names in a manifest. */
function androidPermissions(manifest: string): string[] {
  return [
    ...withoutComments(manifest).matchAll(
      /<uses-permission(?:-sdk-23)?\b[^>]*\bandroid:name="([^"]+)"/g
    ),
  ].map((match) => match[1]!);
}

/** `NS…UsageDescription` keys, and the location accuracy key, in a plist or `project.yml`. */
function iosUsageKeys(source: string): string[] {
  return [...withoutComments(source).matchAll(/\b(NS\w+UsageDescription)\b/g)].map(
    (match) => match[1]!
  );
}

/** The `<string>` value of `key` in a plist, or `undefined`. */
function plistString(plist: string, key: string): string | undefined {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
}

/** Whether a plist sets `key` to `<true/>`. */
function plistTrue(plist: string, key: string): boolean {
  return new RegExp(`<key>${key}</key>\\s*<true\\s*/>`).test(plist);
}

/** Files outside `allowed` whose code (comments aside) calls a platform permission API. */
function permissionCallers(
  sources: Record<string, string>,
  api: RegExp,
  allowed: string
): string[] {
  return Object.entries(sources)
    .filter(([file, text]) => file !== allowed && api.test(withoutComments(text)))
    .map(([file]) => file);
}

const declaredAndroid = androidPermissions(read(ANDROID_MANIFEST));
const declaredIos = [
  ...new Set([...iosUsageKeys(read(IOS_PROJECT)), ...iosUsageKeys(read(IOS_INFO_PLIST))]),
];
const catalogueAndroid = PERMISSIONS.flatMap((p) => p.androidPermissions);
const catalogueIos = PERMISSIONS.flatMap((p) => p.iosUsageDescriptions);
const strings = JSON.parse(read('packages/core-ts/src/generated/strings.json')) as Record<
  string,
  Record<string, string>
>;
const english = strings.en!;

describe('declared permissions and the catalogue agree (REQ-PRV-005)', () => {
  it('declares on Android only catalogue entries and stated non-prompting permissions', () => {
    const unexplained = declaredAndroid.filter(
      (name) => !catalogueAndroid.includes(name) && !(name in NON_PROMPTING)
    );
    expect(
      unexplained,
      'add a catalogue entry in crates/rust-core/src/permissions.rs, or a reason to NON_PROMPTING'
    ).toEqual([]);
    expect(declaredAndroid).toEqual(expect.arrayContaining(Object.keys(NON_PROMPTING)));
  });

  it('declares on iOS only the usage descriptions of catalogue entries', () => {
    expect(
      declaredIos.filter((key) => !catalogueIos.includes(key)),
      'add a catalogue entry in crates/rust-core/src/permissions.rs'
    ).toEqual([]);
  });

  // Red until the platform packages declare each entry: the shared core adds the catalogue entry
  // first, and this names the declaration still missing. Expected red after spec 027's shared
  // core: `POST_NOTIFICATIONS` in the Android manifest, which the Android push package adds.
  it('declares every catalogue entry on the platforms it names', () => {
    const missing = [
      ...catalogueAndroid
        .filter((name) => !declaredAndroid.includes(name))
        .map((name) => `${ANDROID_MANIFEST}: ${name}`),
      ...catalogueIos
        .filter((key) => !iosUsageKeys(read(IOS_PROJECT)).includes(key))
        .map((key) => `${IOS_PROJECT}: ${key}`),
      ...catalogueIos
        .filter((key) => !iosUsageKeys(read(IOS_INFO_PLIST)).includes(key))
        .map((key) => `${IOS_INFO_PLIST}: ${key}`),
    ];
    expect(missing, 'declare it (docs/PERMISSIONS.md, "Adding a permission")').toEqual([]);
  });

  it('gives each declared iOS purpose string its English catalogue text', () => {
    const plist = read(IOS_INFO_PLIST);
    for (const permission of PERMISSIONS) {
      for (const key of permission.iosUsageDescriptions.filter((k) => declaredIos.includes(k))) {
        expect(plistString(plist, key), key).toBe(english[permission.purpose]);
      }
    }
  });

  it('localizes every iOS purpose string in every locale through the generated InfoPlist catalog', () => {
    const catalog = JSON.parse(read(IOS_INFO_PLIST_STRINGS)) as {
      strings: Record<string, { localizations: Record<string, { stringUnit: { value: string } }> }>;
    };
    expect(Object.keys(catalog.strings).sort()).toEqual([...catalogueIos].sort());
    for (const permission of PERMISSIONS) {
      for (const key of permission.iosUsageDescriptions) {
        for (const [locale, dictionary] of Object.entries(strings)) {
          const value = catalog.strings[key]?.localizations[locale]?.stringUnit.value;
          expect(value, `${key} (${locale})`).toBe(dictionary[permission.purpose]);
        }
      }
    }
  });
});

describe('location asks for the least it needs (REQ-PRV-006)', () => {
  it('declares neither precise nor background location', () => {
    const declared = [...declaredAndroid, ...declaredIos, ...catalogueAndroid, ...catalogueIos];
    expect(declared.filter((name) => NEVER_DECLARED.some((rule) => rule.test(name)))).toEqual([]);
  });

  it('asks iOS for reduced accuracy whenever it declares location', () => {
    const plist = read(IOS_INFO_PLIST);
    if (declaredIos.some((key) => key.startsWith('NSLocation'))) {
      expect(plistTrue(plist, 'NSLocationDefaultAccuracyReduced')).toBe(true);
    }
    expect(plistTrue('<key>A</key> <true/>', 'A')).toBe(true);
    expect(plistTrue('<key>A</key><false/>', 'A')).toBe(false);
  });
});

describe('only the permission gateway asks the operating system (REQ-PRV-003)', () => {
  const sources = {
    ios: Object.fromEntries(files('apps/ios/Sources', '.swift').map((f) => [f, read(f)])),
    android: Object.fromEntries(files('apps/android/app/src/main', '.kt').map((f) => [f, read(f)])),
  };

  it.each(['ios', 'android'] as const)('%s calls the request APIs only in its gateway', (os) => {
    expect(
      permissionCallers(sources[os], PLATFORM_PERMISSION_APIS[os], PERMISSION_GATEWAYS[os]),
      `move the call into ${PERMISSION_GATEWAYS[os]}`
    ).toEqual([]);
    const gateway = PERMISSION_GATEWAYS[os];
    if (existsSync(path.join(root, gateway))) {
      expect(PLATFORM_PERMISSION_APIS[os].test(read(gateway)), gateway).toBe(true);
    }
  });

  it('notices a request outside the gateway, and not one in a comment', () => {
    const swift = {
      'a/View.swift': 'let manager = CLLocationManager()\nmanager.requestWhenInUseAuthorization()',
      'a/Note.swift': '// CLLocationManager lives in the gateway',
      [PERMISSION_GATEWAYS.ios]: 'manager.requestWhenInUseAuthorization()',
      'a/Ask.swift':
        'try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert])',
      'a/Read.swift': 'let settings = await center.notificationSettings()',
      'a/Delegate.swift': 'UNUserNotificationCenter.current().delegate = self',
    };
    expect(permissionCallers(swift, PLATFORM_PERMISSION_APIS.ios, PERMISSION_GATEWAYS.ios)).toEqual(
      ['a/View.swift', 'a/Ask.swift', 'a/Read.swift']
    );
    const kotlin = {
      'b/Screen.kt':
        'val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}',
      'b/Other.kt': 'activity.requestPermissions(arrayOf(name), 1)',
      'b/Plain.kt': '/* requestPermissions( */ val x = 1',
    };
    expect(
      permissionCallers(kotlin, PLATFORM_PERMISSION_APIS.android, PERMISSION_GATEWAYS.android)
    ).toEqual(['b/Screen.kt', 'b/Other.kt']);
  });
});

describe('the declaration readers', () => {
  it('read permissions, usage keys and plist values, comments aside', () => {
    const manifest = `<!-- <uses-permission android:name="android.permission.CAMERA" /> -->
      <uses-permission android:name="android.permission.INTERNET" />
      <uses-permission-sdk-23 android:name="android.permission.ACCESS_COARSE_LOCATION"/>`;
    expect(androidPermissions(manifest)).toEqual([
      'android.permission.INTERNET',
      'android.permission.ACCESS_COARSE_LOCATION',
    ]);
    const yaml = `  # NSCameraUsageDescription: not this one\n  NSLocationWhenInUseUsageDescription: Finds it`;
    expect(iosUsageKeys(yaml)).toEqual(['NSLocationWhenInUseUsageDescription']);
    const plist = '<key>NSLocationWhenInUseUsageDescription</key>\n\t<string>Finds it</string>';
    expect(plistString(plist, 'NSLocationWhenInUseUsageDescription')).toBe('Finds it');
    expect(plistString(plist, 'NSCameraUsageDescription')).toBeUndefined();
    expect(
      NEVER_DECLARED.some((rule) => rule.test('NSLocationAlwaysAndWhenInUseUsageDescription'))
    ).toBe(true);
  });
});
