// Verifies: REQ-CODE-004
// One platform floor per app, and no code below it (spec 019, ADR-0045). It reads the native
// projects and hand-written sources, so it lives with the other guards here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

/**
 * The iOS deployment target (ADR-0045): the previous major release while the next one is current.
 * The floor moves once a year, after the autumn releases, in one change that also deletes the code
 * the new floor makes unnecessary.
 */
const IOS_FLOOR = '26.0';

/**
 * Android `minSdk` (ADR-0045): Android 13. The floor moves once a year, after the autumn releases,
 * in one change that also deletes the code the new floor makes unnecessary.
 */
const ANDROID_MIN_SDK = 33;

/** API level of each `Build.VERSION_CODES` name a branch is likely to use. */
const VERSION_CODES: Record<string, number> = {
  KITKAT: 19,
  LOLLIPOP: 21,
  LOLLIPOP_MR1: 22,
  M: 23,
  N: 24,
  N_MR1: 25,
  O: 26,
  O_MR1: 27,
  P: 28,
  Q: 29,
  R: 30,
  S: 31,
  S_V2: 32,
  TIRAMISU: 33,
  UPSIDE_DOWN_CAKE: 34,
  VANILLA_ICE_CREAM: 35,
  BAKLAVA: 36,
};

type Language = 'swift' | 'kotlin' | 'xml';

interface Deprecated {
  language: Language;
  what: string;
  pattern: RegExp;
  replacement: string;
  /** Narrows a match further, given the comment-free code and the index just past the match. */
  applies?: (code: string, end: number) => boolean;
}

/** Deprecated APIs (or shims) whose replacement exists at the floor; the message names it. */
const DEPRECATED: readonly Deprecated[] = [
  {
    language: 'swift',
    what: 'CLGeocoder',
    pattern: /\bCLGeocoder\b/g,
    replacement: 'use MapKit MKReverseGeocodingRequest (iOS 26)',
  },
  {
    language: 'kotlin',
    what: 'blocking Geocoder.getFromLocation(lat, lng, max)',
    pattern: /\.getFromLocation\s*\(/g,
    replacement: 'use the Geocoder.GeocodeListener overload (API 33)',
    applies: isBlockingGetFromLocation,
  },
  {
    language: 'kotlin',
    what: 'LocationManager.requestSingleUpdate',
    pattern: /\brequestSingleUpdate\s*\(/g,
    replacement: 'use LocationManager.getCurrentLocation (API 30)',
  },
  // FLAG_SECURE was the recents shield before API 33. A fork that wants it for real
  // screen-capture protection (not as a recents shield) adds an explicit allowance here.
  {
    language: 'kotlin',
    what: 'FLAG_SECURE as a recents shield',
    pattern: /\bFLAG_SECURE\b/g,
    replacement: 'use Activity.setRecentsScreenshotEnabled(false) (API 33)',
  },
  {
    language: 'xml',
    what: 'fullBackupContent backup rules',
    pattern: /\bfullBackupContent\b|<full-backup-content\b/g,
    replacement: 'use android:dataExtractionRules (API 31) alone',
  },
];

// Comments do not count: prose that names an API or an old version is not code. Every detector
// runs on source with `//` line comments, block comments and XML comments blanked out, newlines
// kept so line numbers still match the file.
function withoutComments(source: string): string {
  const blank = (comment: string) => comment.replace(/[^\n]/g, ' ');
  return source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split('\n').length;
}

function finding(file: string, code: string, index: number, what: string, why: string): string {
  return `${file}:${lineOf(code, index)}: ${what} - ${why}`;
}

/** True when `version` (major or major.minor) is at or below `floor`. */
function atOrBelow(version: string, floor: string): boolean {
  const a = version.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return true;
}

/** `#available(iOS N`, `#unavailable(iOS N`, `@available(iOS N` and `@available(iOS, introduced: N`. */
function swiftAvailability(file: string, source: string, floor = IOS_FLOOR): string[] {
  const code = withoutComments(source);
  const pattern =
    /[#@](?:un)?available\s*\(\s*iOS\s+(\d+(?:\.\d+)?)|@available\s*\(\s*iOS\s*,\s*introduced\s*:\s*(\d+(?:\.\d+)?)/g;
  return [...code.matchAll(pattern)]
    .filter((match) => atOrBelow((match[1] ?? match[2])!, floor))
    .map((match) =>
      finding(
        file,
        code,
        match.index,
        `availability check for iOS ${match[1] ?? match[2]}`,
        `at or below the iOS ${floor} floor, delete the branch (ADR-0045)`
      )
    );
}

const LEVEL = String.raw`\d+|(?:Build\.)?VERSION_CODES\.[A-Z][A-Z0-9_]*`;
const SDK_INT = String.raw`(?:Build\.)?VERSION\.SDK_INT\b`;
const FLIP: Record<string, string> = { '>=': '<=', '<=': '>=', '>': '<', '<': '>' };

function apiLevel(token: string): number | undefined {
  if (/^\d+$/.test(token)) return Number(token);
  return VERSION_CODES[token.replace(/^.*VERSION_CODES\./, '')];
}

/**
 * Whether `SDK_INT <op> level` is decided by the floor alone. A branch splits devices at a level:
 * `>= N` and `< N` split at N, `> N` and `<= N` at N + 1; a split at or below the floor is always
 * the same way. `== N` / `!= N` are pointless only below the floor.
 */
function pointless(op: string, level: number, floor: number): boolean {
  if (op === '==' || op === '!=') return level < floor;
  const split = op === '>' || op === '<=' ? level + 1 : level;
  return split <= floor;
}

/**
 * Kotlin version branches: `SDK_INT` compared to a level, `@RequiresApi` / `@TargetApi`, and any
 * other `VERSION_CODES.X` reference, each at or below the floor.
 */
function kotlinVersionChecks(file: string, source: string, floor = ANDROID_MIN_SDK): string[] {
  const code = withoutComments(source);
  const found: { index: number; text: string }[] = [];
  const judged: [number, number][] = [];
  const why = `at or below minSdk ${floor}, delete the branch (ADR-0045)`;

  const comparisons = [
    new RegExp(String.raw`${SDK_INT}\s*(>=|<=|==|!=|>|<)\s*(${LEVEL})`, 'g'),
    new RegExp(String.raw`(${LEVEL})\s*(>=|<=|==|!=|>|<)\s*${SDK_INT}`, 'g'),
  ];
  comparisons.forEach((pattern, reversed) => {
    for (const match of code.matchAll(pattern)) {
      const [op, token] = reversed
        ? [FLIP[match[2]!] ?? match[2]!, match[1]!]
        : [match[1]!, match[2]!];
      judged.push([match.index, match.index + match[0].length]);
      const level = apiLevel(token);
      if (level !== undefined && pointless(op, level, floor)) {
        found.push({
          index: match.index,
          text: finding(file, code, match.index, `SDK_INT ${op} ${token}`, why),
        });
      }
    }
  });

  const annotation = new RegExp(
    String.raw`@(RequiresApi|TargetApi)\s*\(\s*(?:api\s*=\s*)?(${LEVEL})\s*\)`,
    'g'
  );
  for (const match of code.matchAll(annotation)) {
    judged.push([match.index, match.index + match[0].length]);
    const level = apiLevel(match[2]!);
    if (level !== undefined && level <= floor) {
      found.push({
        index: match.index,
        text: finding(file, code, match.index, `@${match[1]}(${match[2]})`, why),
      });
    }
  }

  for (const match of code.matchAll(/\b(?:Build\.)?VERSION_CODES\.([A-Z][A-Z0-9_]*)/g)) {
    if (judged.some(([start, end]) => match.index >= start && match.index < end)) continue;
    const level = VERSION_CODES[match[1]!];
    if (level !== undefined && level <= floor) {
      found.push({
        index: match.index,
        text: finding(file, code, match.index, `VERSION_CODES.${match[1]} (API ${level})`, why),
      });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.text);
}

/** Top-level arguments of the call whose `(` ends at `open`, and the index past its `)`. */
function callArguments(code: string, open: number): { args: string[]; end: number } {
  let depth = 0;
  let current = '';
  const args: string[] = [];
  for (let i = open; i < code.length; i++) {
    const char = code[i]!;
    if ('([{'.includes(char)) depth++;
    if (')]}'.includes(char)) depth--;
    if (depth === 0) {
      args.push(current);
      return { args: args.map((a) => a.trim()).filter(Boolean), end: i + 1 };
    }
    if (char === ',' && depth === 1) {
      args.push(current);
      current = '';
    } else if (i > open) {
      current += char;
    }
  }
  return { args: [], end: code.length };
}

/** The three-argument overload with no listener argument and no trailing-lambda listener. */
function isBlockingGetFromLocation(code: string, end: number): boolean {
  const call = callArguments(code, end - 1);
  return call.args.length === 3 && !/^\s*\{/.test(code.slice(call.end));
}

function deprecatedApis(file: string, source: string, language: Language): string[] {
  const code = withoutComments(source);
  return DEPRECATED.filter((entry) => entry.language === language).flatMap((entry) =>
    [...code.matchAll(entry.pattern)]
      .filter((match) => !entry.applies || entry.applies(code, match.index + match[0].length))
      .map((match) => finding(file, code, match.index, entry.what, entry.replacement))
  );
}

/** Every declared iOS deployment target in an XcodeGen `project.yml`. */
function iosDeploymentTargets(yaml: string): string[] {
  const lines = yaml.split('\n').map((line) => line.replace(/(^|\s)#.*$/, '$1'));
  const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, '');
  const targets: string[] = [];
  lines.forEach((line, i) => {
    const setting = /\bIPHONEOS_DEPLOYMENT_TARGET\s*:\s*(\S.*)$/.exec(line);
    if (setting) targets.push(unquote(setting[1]!));
    const key = /^(\s*)deploymentTarget\s*:\s*(.*)$/.exec(line);
    if (!key) return;
    if (key[2]!.trim()) {
      targets.push(unquote(key[2]!));
      return;
    }
    const indent = key[1]!.length;
    for (const child of lines.slice(i + 1)) {
      if (!child.trim()) continue;
      if (/^\s*/.exec(child)![0].length <= indent) break;
      const ios = /^\s*iOS\s*:\s*(\S.*)$/.exec(child);
      if (ios) targets.push(unquote(ios[1]!));
    }
  });
  return targets;
}

/** Every `minSdk` (or `minSdkVersion`) a Gradle Kotlin script declares. */
function gradleMinSdks(script: string): number[] {
  const code = withoutComments(script);
  return [...code.matchAll(/\bminSdk(?:Version)?\s*(?:=|\()\s*(\d+)/g)].map((m) => Number(m[1]));
}

const SKIP = /^(build|\.gradle|DerivedData|RustLib|Generated|generated|uniffi)$/;

function files(dir: string, keep: (name: string, parent: string) => boolean): string[] {
  if (!existsSync(path.join(root, dir))) return [];
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.test(entry.name) ? [] : files(relative, keep);
    return keep(entry.name, path.posix.basename(dir)) ? [relative] : [];
  });
}

function read(file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

describe('[REQ-CODE-004] the detectors', () => {
  it('[REQ-CODE-004] flags Swift availability checks at or below the iOS floor, not above', () => {
    const source = [
      'if #available(iOS 17, *) { old() }',
      'guard #unavailable(iOS 26.0) else { return }',
      '@available(iOS 18.4, *) func a() {}',
      '@available(iOS, introduced: 15) func b() {}',
      'if #available(iOS 27, *) { new() }',
      '@available(iOS 26.1, *) func c() {}',
      '// if #available(iOS 17, *) is gone since ADR-0045',
      '/* @available(iOS 16, *) */ func d() {}',
    ].join('\n');
    expect(swiftAvailability('a/V.swift', source)).toEqual([
      'a/V.swift:1: availability check for iOS 17 - at or below the iOS 26.0 floor, delete the branch (ADR-0045)',
      'a/V.swift:2: availability check for iOS 26.0 - at or below the iOS 26.0 floor, delete the branch (ADR-0045)',
      'a/V.swift:3: availability check for iOS 18.4 - at or below the iOS 26.0 floor, delete the branch (ADR-0045)',
      'a/V.swift:4: availability check for iOS 15 - at or below the iOS 26.0 floor, delete the branch (ADR-0045)',
    ]);
  });

  it('[REQ-CODE-004] flags SDK_INT comparisons decided by minSdk, not real branches', () => {
    const source = [
      'if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) old()',
      'if (Build.VERSION.SDK_INT >= 33) old()',
      'if (31 <= Build.VERSION.SDK_INT) old()',
      'if (VERSION.SDK_INT < VERSION_CODES.TIRAMISU) old()',
      'if (Build.VERSION.SDK_INT > 32) old()',
      'if (Build.VERSION.SDK_INT >= 34) new()',
      'if (Build.VERSION.SDK_INT > 33) new()',
      'if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) new()',
      'if (Build.VERSION.SDK_INT == 33) onlyThirteen()',
      'val sdk = Build.VERSION.SDK_INT',
      '// if (Build.VERSION.SDK_INT >= 26) was here',
    ].join('\n');
    expect(kotlinVersionChecks('b/V.kt', source).map((f) => f.split(' - ')[0])).toEqual([
      'b/V.kt:1: SDK_INT >= Build.VERSION_CODES.S',
      'b/V.kt:2: SDK_INT >= 33',
      'b/V.kt:3: SDK_INT >= 31',
      'b/V.kt:4: SDK_INT < VERSION_CODES.TIRAMISU',
      'b/V.kt:5: SDK_INT > 32',
    ]);
  });

  it('[REQ-CODE-004] flags @RequiresApi, @TargetApi and stray VERSION_CODES at or below minSdk', () => {
    const source = [
      '@RequiresApi(Build.VERSION_CODES.O) fun a() {}',
      '@RequiresApi(api = 31) fun b() {}',
      '@TargetApi(Build.VERSION_CODES.TIRAMISU) fun c() {}',
      'private const val API = Build.VERSION_CODES.TIRAMISU',
      '@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE) fun d() {}',
      '@RequiresApi(35) fun e() {}',
      'val next = VERSION_CODES.BAKLAVA',
      '/* @RequiresApi(26) */ fun f() {}',
    ].join('\n');
    expect(kotlinVersionChecks('b/A.kt', source).map((f) => f.split(' - ')[0])).toEqual([
      'b/A.kt:1: @RequiresApi(Build.VERSION_CODES.O)',
      'b/A.kt:2: @RequiresApi(31)',
      'b/A.kt:3: @TargetApi(Build.VERSION_CODES.TIRAMISU)',
      'b/A.kt:4: VERSION_CODES.TIRAMISU (API 33)',
    ]);
  });

  it('[REQ-CODE-004] names the replacement for each deprecated API, and ignores comments', () => {
    const swift = [
      'let marks = try await CLGeocoder().reverseGeocodeLocation(location)',
      '/// CLGeocoder was replaced by MKReverseGeocodingRequest',
      'let request = MKReverseGeocodingRequest(location: location)',
    ].join('\n');
    expect(deprecatedApis('a/G.swift', swift, 'swift')).toEqual([
      'a/G.swift:1: CLGeocoder - use MapKit MKReverseGeocodingRequest (iOS 26)',
    ]);

    const kotlin = [
      'geocoder.getFromLocation(fix.latitude, fix.longitude, 1)?.firstOrNull()',
      'geocoder.getFromLocation(',
      '    fix.latitude,',
      '    fix.longitude,',
      '    1,',
      '    object : Geocoder.GeocodeListener { override fun onGeocode(a: MutableList<Address>) {} },',
      ')',
      'geocoder.getFromLocation(lat, lng, 1) { addresses -> use(addresses) }',
      'manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())',
      'manager.getCurrentLocation(provider, null, executor) { use(it) }',
      'window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)',
      'activity.setRecentsScreenshotEnabled(false)',
      '// requestSingleUpdate and FLAG_SECURE are gone',
    ].join('\n');
    expect(deprecatedApis('b/L.kt', kotlin, 'kotlin')).toEqual([
      'b/L.kt:1: blocking Geocoder.getFromLocation(lat, lng, max) - use the Geocoder.GeocodeListener overload (API 33)',
      'b/L.kt:9: LocationManager.requestSingleUpdate - use LocationManager.getCurrentLocation (API 30)',
      'b/L.kt:11: FLAG_SECURE as a recents shield - use Activity.setRecentsScreenshotEnabled(false) (API 33)',
    ]);

    const manifest = [
      '<application',
      '    android:allowBackup="false"',
      '    <!-- android:fullBackupContent is not needed from API 31 -->',
      '    android:dataExtractionRules="@xml/data_extraction_rules"',
      '    android:fullBackupContent="@xml/backup_rules">',
      '</application>',
      '<full-backup-content><exclude domain="sharedpref" path="x.xml" /></full-backup-content>',
    ].join('\n');
    expect(deprecatedApis('c/AndroidManifest.xml', manifest, 'xml')).toEqual([
      'c/AndroidManifest.xml:5: fullBackupContent backup rules - use android:dataExtractionRules (API 31) alone',
      'c/AndroidManifest.xml:7: fullBackupContent backup rules - use android:dataExtractionRules (API 31) alone',
    ]);
  });

  it('[REQ-CODE-004] reads every declared deployment target and minSdk', () => {
    const yaml = [
      'options:',
      '  # deploymentTarget: 17.0 in a comment does not count',
      '  deploymentTarget:',
      "    iOS: '26.0'",
      '    macOS: "15.0"',
      'targets:',
      '  App:',
      '    deploymentTarget: "17.0"',
      '    settings:',
      '      IPHONEOS_DEPLOYMENT_TARGET: 26.0',
    ].join('\n');
    expect(iosDeploymentTargets(yaml)).toEqual(['26.0', '17.0', '26.0']);
    expect(iosDeploymentTargets('name: App\n')).toEqual([]);
    expect(gradleMinSdks('defaultConfig {\n    minSdk = 33\n    // minSdk = 21\n}')).toEqual([33]);
    expect(gradleMinSdks('defaultConfig { minSdkVersion(26) }')).toEqual([26]);
  });
});

describe('[REQ-CODE-004] the live tree sits on one floor', () => {
  it(`[REQ-CODE-004] iOS declares deployment target ${IOS_FLOOR} and nothing else`, () => {
    const targets = iosDeploymentTargets(read('apps/ios/project.yml'));
    expect(targets.length).toBeGreaterThan(0);
    expect(
      targets.filter((target) => target !== IOS_FLOOR),
      'apps/ios/project.yml'
    ).toEqual([]);
  });

  it(`[REQ-CODE-004] Android declares minSdk ${ANDROID_MIN_SDK} in every Gradle script`, () => {
    expect(gradleMinSdks(read('apps/android/app/build.gradle.kts'))).toEqual([ANDROID_MIN_SDK]);
    const scripts = files('apps/android', (name) => name === 'build.gradle.kts');
    const disagreeing = scripts.flatMap((script) =>
      gradleMinSdks(read(script))
        .filter((sdk) => sdk !== ANDROID_MIN_SDK)
        .map((sdk) => `${script}: minSdk ${sdk}`)
    );
    expect(disagreeing).toEqual([]);
  });

  it('[REQ-CODE-004] hand-written native code has no branch, shim or deprecated API below the floor', () => {
    const swift = files('apps/ios', (name) => name.endsWith('.swift'));
    const kotlin = files('apps/android', (name) => name.endsWith('.kt'));
    const xml = files(
      'apps/android',
      (name, parent) =>
        name === 'AndroidManifest.xml' || (parent === 'xml' && name.endsWith('.xml'))
    );
    expect(swift.length).toBeGreaterThan(5);
    expect(kotlin.length).toBeGreaterThan(5);
    expect(xml.length).toBeGreaterThan(0);

    const findings = [
      ...swift.flatMap((file) => {
        const source = read(file);
        return [...swiftAvailability(file, source), ...deprecatedApis(file, source, 'swift')];
      }),
      ...kotlin.flatMap((file) => {
        const source = read(file);
        return [...kotlinVersionChecks(file, source), ...deprecatedApis(file, source, 'kotlin')];
      }),
      ...xml.flatMap((file) => deprecatedApis(file, read(file), 'xml')),
    ];
    expect(findings).toEqual([]);
  });
});
