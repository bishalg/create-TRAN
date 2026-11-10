#!/usr/bin/env node
/**
 * Mobile release with fastlane (spec 025, ADR-0042). Two commands, both run by `pnpm` scripts:
 *
 * - `doctor <ios|android>`: each variable a delivery lane needs, as set or missing (never its value);
 *   exits 1 when one is missing. Every lane of `apps/<platform>/fastlane/Fastfile` that delivers runs it
 *   (`pnpm mobile:doctor <platform>`) right after `pnpm release:check` (REQ-MOB-006).
 * - `check`: the repo's lanes, Gradle signing and delivery workflow follow the rules of spec 025
 *   (REQ-MOB-001..004, 007..009), the same functions the tests exercise.
 *
 * Zero dependencies (ADR-0016). The Fastfiles are Ruby; this reads them as text, which is enough because
 * they keep one shape: top-level `desc "…"` then `lane :name do` … `end`.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unpinnedActions } from '../supply-chain/supply-chain.mjs';

export const PLATFORMS = ['ios', 'android'];
export const LANES = ['doctor', 'test', 'metadata', 'beta', 'release'];
/** Lanes that talk to a store: `release:check` and the doctor run first in each. */
export const DELIVERY_LANES = ['metadata', 'beta', 'release'];

/** Identifiers that may fall back to the template's placeholder, which the scaffolder rewrites. */
export const PLACEHOLDER_ID = 'com.tran.voting';
export const DEFAULTED = {
  ios: ['TRAN_IOS_BUNDLE_ID'],
  android: ['TRAN_ANDROID_APPLICATION_ID'],
};

/** Identifiers and credentials with no default anywhere (REQ-MOB-004). */
export const REQUIRED = {
  ios: [
    'TRAN_APPLE_TEAM_ID',
    'TRAN_ASC_APP_ID',
    'TRAN_ASC_KEY_ID',
    'TRAN_ASC_ISSUER_ID',
    'TRAN_ASC_KEY_P8',
  ],
  android: [
    'TRAN_ANDROID_KEYSTORE_BASE64',
    'TRAN_ANDROID_KEYSTORE_PASSWORD',
    'TRAN_ANDROID_KEY_ALIAS',
    'TRAN_ANDROID_KEY_PASSWORD',
    'TRAN_PLAY_SERVICE_ACCOUNT_JSON',
  ],
};

/**
 * App configuration Gradle reads that store delivery does not need, so the doctor never requires it:
 * the API base URL (REQ-NAT-011; a default per build type) and Firebase's four public project values
 * (spec 027, ADR-0044; all absent means push is switched off, REQ-PSH-012).
 */
export const ANDROID_OPTIONAL_BUILD_VALUES = [
  'TRAN_API_BASE_URL',
  'TRAN_FCM_PROJECT_ID',
  'TRAN_FCM_APP_ID',
  'TRAN_FCM_API_KEY',
  'TRAN_FCM_SENDER_ID',
  // The store page "Update" opens (spec 028, REQ-VER-011); a placeholder default.
  'TRAN_ANDROID_STORE_URL',
];

/** Gradle signing reads these four; when any is absent the release build stays unsigned (REQ-MOB-008). */
export const ANDROID_SIGNING = REQUIRED.android.filter((name) => name.startsWith('TRAN_ANDROID_'));

/** The doctor's report for one platform: one line per variable, and whether all required ones are set. */
export function doctor(platform, env) {
  if (!REQUIRED[platform]) throw new Error(`unknown platform "${platform}" (ios or android)`);
  const isSet = (name) => typeof env[name] === 'string' && env[name].trim() !== '';
  const missing = REQUIRED[platform].filter((name) => !isSet(name));
  const lines = [
    ...REQUIRED[platform].map((name) => `  ${isSet(name) ? 'set    ' : 'missing'}  ${name}`),
    ...DEFAULTED[platform].map(
      (name) =>
        `  ${isSet(name) ? 'set    ' : 'default'}  ${name}${isSet(name) ? '' : ` (${PLACEHOLDER_ID})`}`
    ),
  ];
  const summary = missing.length
    ? `mobile-release doctor (${platform}): ${missing.length} missing; set them in CI secrets or an untracked .env (see .env.example)`
    : `mobile-release doctor (${platform}): ok`;
  return { ok: missing.length === 0, missing, text: [summary, ...lines].join('\n') };
}

/** Lanes of a Fastfile in file order: `{ name, desc, body }`, `body` the statement lines. */
export function parseLanes(ruby) {
  const lines = ruby.split('\n');
  const lanes = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^lane :([a-z_]+) do\s*$/.exec(lines[i]);
    if (!match) continue;
    let back = i - 1;
    while (back >= 0 && /^\s*#/.test(lines[back])) back--;
    const desc = /^desc\s+["'](.+)["']\s*$/.exec(lines[back] ?? '')?.[1] ?? '';
    const body = [];
    let j = i + 1;
    for (; j < lines.length && lines[j] !== 'end'; j++) {
      const statement = lines[j].trim();
      if (statement && !statement.startsWith('#')) body.push(statement);
    }
    lanes.push({ name: match[1], desc, body });
    i = j;
  }
  return lanes;
}

/** Environment reads in Ruby (`ENV["X"]`, `ENV.fetch("X"[, default])`): `{ name, fallback }`. */
export function rubyEnvReads(ruby) {
  const reads = [];
  for (const m of ruby.matchAll(
    /ENV\.fetch\(\s*["']([A-Z][A-Z0-9_]*)["']\s*(?:,\s*([^)]+?))?\s*\)/g
  ))
    reads.push({ name: m[1], fallback: m[2] ?? null });
  for (const m of ruby.matchAll(
    /ENV\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\](?:\s*(?:\|\||or)\s*([^\s)]+))?/g
  ))
    reads.push({ name: m[1], fallback: m[2] ?? null });
  return reads;
}

/** Environment reads in Gradle Kotlin (`System.getenv`, `providers.environmentVariable`). */
export function gradleEnvReads(kts) {
  const reads = [];
  const pattern =
    /(?:System\.getenv|providers\.environmentVariable)\(\s*"([A-Z][A-Z0-9_]*)"\s*\)(?:\.(?:orNull|get\(\)))?(?:\s*\?:\s*("[^"]*"))?/g;
  for (const m of kts.matchAll(pattern)) reads.push({ name: m[1], fallback: m[2] ?? null });
  return reads;
}

/** Actions and settings that change a version or build number (ADR-0034: only `pnpm release` may). */
export const VERSION_BUMPS =
  /\b(increment_build_number|increment_version_number|increment_version_code|increment_version_name|android_set_version_code|android_set_version_name|set_info_plist_value|update_info_plist|update_plist|versioning_\w+|CURRENT_PROJECT_VERSION|MARKETING_VERSION|versionCode|versionName)\b|pnpm["',\s]+release["',\s]+(?:bump|set|auto|major|minor|patch)/;

const TEST_COMMAND = { ios: 'ios:test', android: 'android:test' };
const sh = (...args) => `sh(${args.map((a) => `"${a}"`).join(', ')})`;
export const RELEASE_CHECK = sh('pnpm', 'release:check');
export const doctorCall = (platform) => sh('pnpm', '--silent', 'mobile:doctor', platform);

/** Problems with one platform's Fastfile and Appfile against REQ-MOB-002, 003, 004, 006, 007. */
export function laneProblems(platform, fastfile, appfile) {
  const where = `apps/${platform}/fastlane/Fastfile`;
  const problems = [];
  const lanes = parseLanes(fastfile);
  const names = lanes.map((lane) => lane.name);
  if (names.join() !== LANES.join())
    problems.push(`${where}: lanes are [${names.join(', ')}], expected [${LANES.join(', ')}]`);
  const lane = Object.fromEntries(lanes.map((l) => [l.name, l]));
  for (const { name, desc } of lanes)
    if (!desc) problems.push(`${where}: lane ${name} has no desc`);

  if (lane.doctor && lane.doctor.body.join('\n') !== doctorCall(platform))
    problems.push(`${where}: doctor must only run ${doctorCall(platform)}`);
  if (lane.test && lane.test.body.join('\n') !== sh('pnpm', TEST_COMMAND[platform]))
    problems.push(`${where}: test must only run ${sh('pnpm', TEST_COMMAND[platform])}`);
  for (const name of DELIVERY_LANES) {
    const [first, second] = lane[name]?.body ?? [];
    if (lane[name] && (first !== RELEASE_CHECK || second !== doctorCall(platform)))
      problems.push(
        `${where}: ${name} must start with ${RELEASE_CHECK} then ${doctorCall(platform)}`
      );
  }
  problems.push(...deliveryProblems(platform, lane).map((p) => `${where}: ${p}`));

  for (const [file, text] of [
    [where, fastfile],
    [`apps/${platform}/fastlane/Appfile`, appfile],
  ]) {
    const bump = VERSION_BUMPS.exec(text);
    if (bump) problems.push(`${file}: "${bump[0]}" changes a version; use pnpm release (ADR-0034)`);
    for (const { name, fallback } of rubyEnvReads(text)) {
      if (fallback === null) continue;
      if (DEFAULTED[platform].includes(name) && fallback === `"${PLACEHOLDER_ID}"`) continue;
      problems.push(
        `${file}: ${name} has a default (${fallback}); identifiers and credentials come from the environment`
      );
    }
  }
  return problems;
}

/** What `beta`, `release` and `metadata` do on each platform (REQ-MOB-007, REQ-MOB-011 lane half). */
function deliveryProblems(platform, lane) {
  const text = (name) => lane[name]?.body.join('\n') ?? '';
  const problems = [];
  const need = (name, pattern, what) => {
    if (lane[name] && !pattern.test(text(name))) problems.push(`${name} must ${what}`);
  };
  const never = (name, pattern, what) => {
    if (pattern.test(text(name))) problems.push(`${name} must not ${what}`);
  };
  const BUILD = /\b(build_app|gym|build_ios_app|gradle|gradlew|xcodebuild)\b/;
  never('release', BUILD, 'build; it promotes the build that beta uploaded');
  never('metadata', BUILD, 'build; it uploads listing text only');
  if (platform === 'ios') {
    need('beta', /\bbuild_app\(/, 'build the .ipa with build_app');
    need('beta', /-allowProvisioningUpdates/, 'sign with automatic, cloud-managed signing');
    need('beta', /\bupload_to_testflight\(/, 'upload to TestFlight');
    need(
      'release',
      /\bdeliver\([^]*submit_for_review: true/,
      'submit with deliver(submit_for_review: true)'
    );
    need('release', /skip_binary_upload: true/, 'skip the binary upload');
    need(
      'metadata',
      /\bdeliver\([^]*metadata_path: "fastlane\/metadata"/,
      'upload fastlane/metadata'
    );
    need('metadata', /skip_binary_upload: true/, 'skip the binary upload');
    never('metadata', /submit_for_review: true/, 'submit for review');
  } else {
    need(
      'beta',
      /\bgradle\([^]*task: "bundle"[^]*build_type: "Release"/,
      'build the .aab (bundleRelease)'
    );
    need('beta', /\bupload_to_play_store\([^]*track: "internal"/, 'upload to the internal track');
    need(
      'release',
      /track: "internal"[^]*track_promote_to: "production"/,
      'promote internal to production'
    );
    need(
      'metadata',
      /metadata_path: "fastlane\/metadata\/android"/,
      'upload fastlane/metadata/android'
    );
    for (const flag of ['skip_upload_apk', 'skip_upload_aab']) {
      need('release', new RegExp(`${flag}: true`), `set ${flag}`);
      need('metadata', new RegExp(`${flag}: true`), `set ${flag}`);
    }
  }
  return problems;
}

/** Gradle release signing comes from the environment, only when every variable is set (REQ-MOB-008). */
export function gradleSigningProblems(kts) {
  const where = 'apps/android/app/build.gradle.kts';
  const problems = [];
  const reads = gradleEnvReads(kts);
  for (const name of ANDROID_SIGNING) {
    const read = reads.find((r) => r.name === name);
    if (!read) problems.push(`${where}: does not read ${name}`);
    else if (read.fallback !== null) problems.push(`${where}: ${name} has a default`);
  }
  if (!/signingConfigs\s*\{[^]*create\("upload"\)/.test(kts))
    problems.push(`${where}: no "upload" signing config`);
  if (!/if\s*\([^)]*\)\s*signingConfig\s*=\s*signingConfigs\.getByName\("upload"\)/.test(kts))
    problems.push(
      `${where}: the release build must use the upload config only when it is configured`
    );
  return problems;
}

/** The variables doctor lists are exactly the ones lanes and Gradle signing read without a default. */
export function contractProblems(platform, reads) {
  const read = new Set(reads.map((r) => r.name).filter((n) => !DEFAULTED[platform].includes(n)));
  const required = new Set(REQUIRED[platform]);
  return [
    ...[...read]
      .filter((n) => !required.has(n))
      .map((n) => `${platform}: ${n} is read but doctor does not check it`),
    ...[...required]
      .filter((n) => !read.has(n))
      .map((n) => `${platform}: doctor checks ${n} but no lane reads it`),
  ];
}

/** `on:` keys of a workflow: the trigger events. */
export function workflowTriggers(yaml) {
  const block = /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(yaml);
  if (!block) return [];
  return [...block[1].matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
}

/** Options of a `workflow_dispatch` choice input. */
export function choiceOptions(yaml, input) {
  const block = new RegExp(`^ {6}${input}:\\s*\\n((?: {8,}.*\\n)*)`, 'm').exec(yaml);
  if (!block) return [];
  const list = /options:\s*\[([^\]]*)\]/.exec(block[1]);
  if (list)
    return list[1]
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  return [...block[1].matchAll(/^ {10,}- ([\w-]+)\s*$/gm)].map((m) => m[1]);
}

/** Problems with `.github/workflows/mobile-release.yml` against REQ-MOB-009. */
export function workflowProblems(yaml) {
  const where = '.github/workflows/mobile-release.yml';
  const problems = [];
  const triggers = workflowTriggers(yaml);
  if (triggers.join() !== 'workflow_dispatch')
    problems.push(
      `${where}: triggers are [${triggers.join(', ')}]; only workflow_dispatch is allowed`
    );
  if (choiceOptions(yaml, 'platform').join() !== PLATFORMS.join())
    problems.push(`${where}: input platform must offer ${PLATFORMS.join(' | ')}`);
  if (choiceOptions(yaml, 'lane').join() !== LANES.join())
    problems.push(`${where}: input lane must offer ${LANES.join(' | ')}`);
  problems.push(...unpinnedActions(yaml).map((p) => `${where}: ${p}`));

  const all = [...REQUIRED.ios, ...REQUIRED.android, ...DEFAULTED.ios, ...DEFAULTED.android];
  for (const name of all)
    if (!new RegExp(`^\\s+${name}: \\$\\{\\{ secrets\\.${name} \\}\\}$`, 'm').test(yaml))
      problems.push(`${where}: ${name} must come from secrets.${name}`);
  for (const m of yaml.matchAll(/^\s+(TRAN_[A-Z0-9_]+):\s*(.*)$/gm))
    if (m[2] !== `\${{ secrets.${m[1]} }}`)
      problems.push(`${where}: ${m[1]} is not read from a secret`);

  const steps = yaml.split(/\n(?= {6}- )/).slice(1);
  const gate = steps.findIndex((s) => /id: secrets\b/.test(s));
  if (gate !== 0) problems.push(`${where}: the first step must be the secrets gate (id: secrets)`);
  else {
    if (!/::notice::/.test(steps[0]) || !/skip=true/.test(steps[0]) || /exit 1/.test(steps[0]))
      problems.push(`${where}: the gate must skip with a ::notice::, not fail`);
    for (const step of steps.slice(1))
      if (!/if: steps\.secrets\.outputs\.skip != 'true'/.test(step))
        problems.push(
          `${where}: step "${/name: (.*)/.exec(step)?.[1] ?? step.trim().split('\n')[0]}" is not gated`
        );
  }
  return problems;
}

/** Root `package.json` scripts the release flow relies on. */
export function scriptProblems(scripts) {
  const problems = [];
  const expect = {
    'ios:lane': /^cd apps\/ios && .*bundle exec fastlane$/,
    'android:lane': /^cd apps\/android && .*bundle exec fastlane$/,
    'mobile:doctor': /^node tooling\/mobile-release\/mobile-release\.mjs doctor$/,
    'mobile:check':
      /node --test tooling\/mobile-release\/\*\.test\.mjs && node tooling\/mobile-release\/mobile-release\.mjs check/,
  };
  for (const [name, pattern] of Object.entries(expect))
    if (!pattern.test(scripts[name] ?? ''))
      problems.push(`package.json: script ${name} does not match ${pattern}`);
  for (const name of ['ios:lane', 'android:lane'])
    for (const quiet of ['FASTLANE_SKIP_UPDATE_CHECK=1', 'FASTLANE_OPT_OUT_USAGE=1'])
      if (!(scripts[name] ?? '').includes(quiet))
        problems.push(`package.json: ${name} does not set ${quiet}`);
  if (!/pnpm mobile:check/.test(scripts['check:quick'] ?? ''))
    problems.push('package.json: check:quick does not run pnpm mobile:check');
  return problems;
}

/** fastlane is pinned through bundler (REQ-MOB-001). */
export function bundlerProblems(gemfile, lockfile) {
  const problems = [];
  if (!/^gem ["']fastlane["']/m.test(gemfile ?? ''))
    problems.push('Gemfile: does not name fastlane');
  if (!/^DEPENDENCIES\n(?: {2}.*\n)*? {2}fastlane\b/m.test(lockfile ?? ''))
    problems.push('Gemfile.lock: missing or does not lock fastlane (run bundle lock)');
  return problems;
}

/** Every check over a repo root. */
export function checkAll(root) {
  const read = (path) =>
    existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null;
  const problems = [...bundlerProblems(read('Gemfile'), read('Gemfile.lock'))];
  const kts = read('apps/android/app/build.gradle.kts') ?? '';
  for (const platform of PLATFORMS) {
    const fastfile = read(`apps/${platform}/fastlane/Fastfile`);
    const appfile = read(`apps/${platform}/fastlane/Appfile`);
    if (fastfile === null || appfile === null) {
      problems.push(`apps/${platform}/fastlane: Fastfile or Appfile missing`);
      continue;
    }
    problems.push(...laneProblems(platform, fastfile, appfile));
    const reads = [...rubyEnvReads(fastfile), ...rubyEnvReads(appfile)];
    if (platform === 'android')
      reads.push(...gradleEnvReads(kts).filter((r) => ANDROID_SIGNING.includes(r.name)));
    problems.push(...contractProblems(platform, reads));
  }
  problems.push(...gradleSigningProblems(kts));
  const workflow = read('.github/workflows/mobile-release.yml');
  problems.push(
    ...(workflow === null
      ? ['.github/workflows/mobile-release.yml: missing']
      : workflowProblems(workflow))
  );
  problems.push(...scriptProblems(JSON.parse(read('package.json') ?? '{}').scripts ?? {}));
  return problems;
}

function main([command, platform]) {
  if (command === 'doctor') {
    const report = doctor(platform, process.env);
    (report.ok ? console.log : console.error)(report.text);
    process.exit(report.ok ? 0 : 1);
  }
  if (command === 'check') {
    const problems = checkAll(process.cwd());
    for (const problem of problems) console.error(`✗ ${problem}`);
    if (problems.length) process.exit(1);
    console.log('mobile-release: ok (lanes, signing, workflow and scripts follow spec 025)');
    return;
  }
  console.error('usage: mobile-release.mjs doctor <ios|android> | check');
  process.exit(2);
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main(process.argv.slice(2));
