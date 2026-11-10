// Verifies: REQ-MOB-001, REQ-MOB-002, REQ-MOB-003, REQ-MOB-004, REQ-MOB-006, REQ-MOB-007, REQ-MOB-008, REQ-MOB-009
// Credentials in fixtures are fake and built so this file does not trip `pnpm secrets:check`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  ANDROID_OPTIONAL_BUILD_VALUES,
  DEFAULTED,
  DELIVERY_LANES,
  LANES,
  PLATFORMS,
  REQUIRED,
  bundlerProblems,
  checkAll,
  choiceOptions,
  contractProblems,
  doctor,
  gradleEnvReads,
  gradleSigningProblems,
  laneProblems,
  parseLanes,
  rubyEnvReads,
  scriptProblems,
  workflowProblems,
  workflowTriggers,
} from './mobile-release.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(`${ROOT}/${path}`, 'utf8');
const fastfile = (platform) => read(`apps/${platform}/fastlane/Fastfile`);
const appfile = (platform) => read(`apps/${platform}/fastlane/Appfile`);
const CLI = fileURLToPath(new URL('./mobile-release.mjs', import.meta.url));

describe('fastlane is pinned (REQ-MOB-001)', () => {
  it('REQ-MOB-001 the Gemfile names fastlane and Gemfile.lock locks it', () => {
    assert.deepEqual(bundlerProblems(read('Gemfile'), read('Gemfile.lock')), []);
    assert.match(read('Gemfile.lock'), /^ {4}fastlane \(\d+\.\d+\.\d+\)$/m);
  });

  it('REQ-MOB-001 a missing Gemfile or lockfile fails', () => {
    assert.deepEqual(bundlerProblems(null, null), [
      'Gemfile: does not name fastlane',
      'Gemfile.lock: missing or does not lock fastlane (run bundle lock)',
    ]);
    assert.equal(bundlerProblems('gem "fastlane"', 'DEPENDENCIES\n  rake\n').length, 1);
  });

  it('REQ-MOB-001 the lane scripts run fastlane through bundle exec', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    for (const platform of PLATFORMS)
      assert.match(scripts[`${platform}:lane`], /bundle exec fastlane$/);
  });
});

describe('both platforms have the same lanes (REQ-MOB-002)', () => {
  const sample = [
    '# header',
    'def helper',
    '  ENV["X"]',
    'end',
    '',
    'desc "First lane"',
    'lane :one do',
    '  sh("a")',
    '  # a comment',
    '',
    '  sh("b")',
    'end',
    '',
    'lane :two do',
    'end',
  ].join('\n');

  it('REQ-MOB-002 parses lanes, their desc and their statements', () => {
    assert.deepEqual(parseLanes(sample), [
      { name: 'one', desc: 'First lane', body: ['sh("a")', 'sh("b")'] },
      { name: 'two', desc: '', body: [] },
    ]);
  });

  for (const platform of PLATFORMS) {
    it(`REQ-MOB-002 ${platform}: exactly ${LANES.join(', ')}, each with a desc`, () => {
      const lanes = parseLanes(fastfile(platform));
      assert.deepEqual(
        lanes.map((l) => l.name),
        LANES
      );
      for (const lane of lanes) assert.ok(lane.desc.length > 20, `${lane.name} desc`);
    });
  }

  it('REQ-MOB-002 a missing, extra or undescribed lane fails', () => {
    const problems = laneProblems('ios', sample, '');
    assert.ok(problems.some((p) => /lanes are \[one, two\]/.test(p)));
    assert.ok(problems.some((p) => /lane two has no desc/.test(p)));
  });
});

describe('lanes reuse the repo and never own the version (REQ-MOB-003)', () => {
  for (const platform of PLATFORMS) {
    const lanes = Object.fromEntries(parseLanes(fastfile(platform)).map((l) => [l.name, l]));

    it(`REQ-MOB-003 ${platform}: test runs pnpm ${platform}:test and nothing else`, () => {
      assert.deepEqual(lanes.test.body, [`sh("pnpm", "${platform}:test")`]);
    });

    it(`REQ-MOB-003 REQ-MOB-006 ${platform}: delivery lanes run release:check, then the doctor, first`, () => {
      for (const name of DELIVERY_LANES)
        assert.deepEqual(lanes[name].body.slice(0, 2), [
          'sh("pnpm", "release:check")',
          `sh("pnpm", "--silent", "mobile:doctor", "${platform}")`,
        ]);
    });

    it(`REQ-MOB-003 ${platform}: the real Fastfile and Appfile pass every lane rule`, () => {
      assert.deepEqual(laneProblems(platform, fastfile(platform), appfile(platform)), []);
    });
  }

  it('REQ-MOB-003 a test lane that restates the command, or a delivery lane out of order, fails', () => {
    const text = read('apps/android/fastlane/Fastfile')
      .replace('sh("pnpm", "android:test")', 'sh("./gradlew", "testDebugUnitTest")')
      .replace(
        /(lane :beta do\n)(\s+sh\("pnpm", "release:check"\)\n)(\s+sh\("pnpm", "--silent"[^\n]+\n)/,
        '$1$3$2'
      );
    const problems = laneProblems('android', text, '');
    assert.ok(problems.some((p) => /test must only run sh\("pnpm", "android:test"\)/.test(p)));
    assert.ok(problems.some((p) => /beta must start with/.test(p)));
  });

  for (const bump of [
    'increment_build_number',
    'increment_version_number',
    'increment_version_code',
    'android_set_version_name',
    'update_info_plist',
    'sh("pnpm", "release", "bump")',
    'CURRENT_PROJECT_VERSION=2',
  ])
    it(`REQ-MOB-003 "${bump}" anywhere in a Fastfile fails`, () => {
      const text = fastfile('ios').replace('lane :beta do\n', `lane :beta do\n  ${bump}\n`);
      assert.ok(laneProblems('ios', text, '').some((p) => /changes a version/.test(p)));
    });
});

describe('identifiers and credentials come from the environment (REQ-MOB-004)', () => {
  it('REQ-MOB-004 reads ENV and ENV.fetch, with or without a fallback', () => {
    assert.deepEqual(rubyEnvReads('ENV["A"] ENV.fetch("B") ENV.fetch("C", "x") ENV["D"] || "y"'), [
      { name: 'B', fallback: null },
      { name: 'C', fallback: '"x"' },
      { name: 'A', fallback: null },
      { name: 'D', fallback: '"y"' },
    ]);
    assert.deepEqual(
      gradleEnvReads('System.getenv("A") ?: "x"; providers.environmentVariable("B").orNull'),
      [
        { name: 'A', fallback: '"x"' },
        { name: 'B', fallback: null },
      ]
    );
  });

  it('REQ-MOB-004 only the bundle and application ids may default, and only to the placeholder', () => {
    const lane = (body) => `desc "x"\nlane :doctor do\n  ${body}\nend\n`;
    const problems = (platform, body) =>
      laneProblems(platform, lane(body), '').filter((p) => /default/.test(p));
    assert.deepEqual(problems('ios', 'ENV.fetch("TRAN_IOS_BUNDLE_ID", "com.tran.voting")'), []);
    assert.equal(problems('ios', 'ENV.fetch("TRAN_IOS_BUNDLE_ID", "com.acme.app")').length, 1);
    assert.equal(problems('ios', 'ENV.fetch("TRAN_APPLE_TEAM_ID", "ABC")').length, 1);
    assert.equal(problems('android', 'ENV["TRAN_ANDROID_KEY_ALIAS"] || "upload"').length, 1);
  });

  for (const platform of PLATFORMS)
    it(`REQ-MOB-004 ${platform}: doctor checks exactly the variables the lanes and Gradle read without a default`, () => {
      const reads = [...rubyEnvReads(fastfile(platform)), ...rubyEnvReads(appfile(platform))];
      if (platform === 'android')
        reads.push(
          ...gradleEnvReads(read('apps/android/app/build.gradle.kts')).filter(
            (r) => !ANDROID_OPTIONAL_BUILD_VALUES.includes(r.name)
          )
        );
      assert.deepEqual(contractProblems(platform, reads), []);
      assert.deepEqual(contractProblems(platform, [...reads, { name: 'TRAN_NEW' }]), [
        `${platform}: TRAN_NEW is read but doctor does not check it`,
      ]);
    });

  it('REQ-MOB-004 Gradle reads only delivery variables or named optional build values, never both', () => {
    const delivery = [...REQUIRED.android, ...DEFAULTED.android];
    assert.deepEqual(
      ANDROID_OPTIONAL_BUILD_VALUES.filter((name) => delivery.includes(name)),
      [],
      'an optional build value is never required for delivery'
    );
    const unclassified = gradleEnvReads(read('apps/android/app/build.gradle.kts'))
      .map((r) => r.name)
      .filter((name) => !delivery.includes(name) && !ANDROID_OPTIONAL_BUILD_VALUES.includes(name));
    assert.deepEqual(unclassified, [], 'classify a new Gradle variable: delivery or optional');
    assert.ok(ANDROID_OPTIONAL_BUILD_VALUES.includes('TRAN_FCM_API_KEY'));
  });

  it('REQ-MOB-004 Gradle builds the application id fastlane uploads: one variable, one default', () => {
    const name = DEFAULTED.android[0];
    const gradle = gradleEnvReads(read('apps/android/app/build.gradle.kts')).filter(
      (r) => r.name === name
    );
    const fastlane = rubyEnvReads(appfile('android')).filter((r) => r.name === name);
    assert.equal(gradle.length, 1, `build.gradle.kts reads ${name} once`);
    assert.equal(fastlane.length, 1, `Appfile reads ${name} once`);
    assert.equal(gradle[0].fallback, '"com.tran.voting"');
    assert.equal(gradle[0].fallback, fastlane[0].fallback);
    assert.match(
      read('apps/android/app/build.gradle.kts'),
      new RegExp(`^\\s*applicationId = System\\.getenv\\("${name}"\\)`, 'm')
    );
  });

  it('REQ-MOB-004 every variable is in .env.example with an empty value and a comment', () => {
    const example = read('.env.example');
    for (const name of [...Object.values(REQUIRED), ...Object.values(DEFAULTED)].flat())
      assert.match(example, new RegExp(`^# .+\\n${name}=$`, 'm'), name);
  });
});

describe('doctor says what is missing (REQ-MOB-006)', () => {
  const fake = (name) => `fake-${name.toLowerCase()}-` + 'value';
  const complete = (platform) => Object.fromEntries(REQUIRED[platform].map((n) => [n, fake(n)]));
  const run = (platform, env) =>
    spawnSync(process.execPath, [CLI, 'doctor', platform], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });

  for (const platform of PLATFORMS) {
    it(`REQ-MOB-006 ${platform}: an empty environment exits 1 and lists every variable as missing`, () => {
      const out = run(platform, {});
      assert.equal(out.status, 1);
      for (const name of REQUIRED[platform])
        assert.match(out.stderr, new RegExp(`missing  ${name}$`, 'm'));
      for (const name of DEFAULTED[platform])
        assert.match(out.stderr, new RegExp(`default  ${name} \\(com\\.tran\\.voting\\)$`, 'm'));
      assert.match(
        out.stderr,
        new RegExp(`\\(${platform}\\): ${REQUIRED[platform].length} missing`)
      );
    });

    it(`REQ-MOB-006 ${platform}: a complete environment exits 0 and prints no value`, () => {
      const env = { ...complete(platform), [DEFAULTED[platform][0]]: 'com.acme.secretname' };
      const out = run(platform, env);
      assert.equal(out.status, 0, out.stderr);
      assert.match(out.stdout, new RegExp(`doctor \\(${platform}\\): ok`));
      for (const name of REQUIRED[platform])
        assert.match(out.stdout, new RegExp(`set      ${name}$`, 'm'));
      for (const value of Object.values(env))
        assert.ok(!out.stdout.includes(value), 'printed a value');
    });
  }

  it('REQ-MOB-006 a blank value counts as missing; the other platform is not required', () => {
    const report = doctor('ios', { ...complete('ios'), TRAN_ASC_KEY_P8: '  ' });
    assert.deepEqual(report.missing, ['TRAN_ASC_KEY_P8']);
    assert.equal(doctor('android', complete('android')).ok, true);
    assert.throws(() => doctor('web', {}), /unknown platform/);
  });

  it('REQ-MOB-006 the CLI rejects an unknown command', () => {
    const out = spawnSync(process.execPath, [CLI, 'nope'], { encoding: 'utf8' });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /usage/);
  });
});

describe('beta builds once; release promotes that build (REQ-MOB-007)', () => {
  const lanes = (platform) =>
    Object.fromEntries(parseLanes(fastfile(platform)).map((l) => [l.name, l.body.join('\n')]));

  it('REQ-MOB-007 iOS: beta signs with the API key and cloud-managed signing, then uploads to TestFlight', () => {
    const { beta } = lanes('ios');
    assert.match(beta, /build_app\(/);
    assert.match(beta, /"-allowProvisioningUpdates", "-authenticationKeyPath"/);
    assert.match(beta, /export_method: "app-store"/);
    assert.match(beta, /upload_to_testflight\(api_key: api_key/);
    assert.match(fastfile('ios'), /app_store_connect_api_key\(/);
  });

  it('REQ-MOB-007 Android: beta builds a signed .aab and uploads it to the internal track', () => {
    const { beta } = lanes('android');
    assert.match(beta, /gradle\(task: "bundle", build_type: "Release"/);
    assert.match(
      beta,
      /upload_to_play_store\([^\n]*track: "internal", aab: lane_context\[SharedValues::GRADLE_AAB_OUTPUT_PATH\]/
    );
  });

  it('REQ-MOB-007 release submits or promotes and never builds', () => {
    assert.match(
      lanes('ios').release,
      /deliver\([^\n]*submit_for_review: true, skip_binary_upload: true/
    );
    assert.match(lanes('android').release, /track: "internal", track_promote_to: "production"/);
    for (const platform of PLATFORMS)
      assert.doesNotMatch(lanes(platform).release, /build_app|gradle|xcodebuild/);
    const rebuilt = fastfile('android').replace(
      'track_promote_to: "production"',
      'track_promote_to: "production")\n  gradle(task: "bundle"'
    );
    assert.ok(laneProblems('android', rebuilt, '').some((p) => /release must not build/.test(p)));
  });

  it('REQ-MOB-011 metadata uploads fastlane/metadata without a binary', () => {
    assert.match(
      lanes('ios').metadata,
      /deliver\([^\n]*metadata_path: "fastlane\/metadata", skip_binary_upload: true/
    );
    assert.match(
      lanes('android').metadata,
      /metadata_path: "fastlane\/metadata\/android", skip_upload_apk: true, skip_upload_aab: true/
    );
    const submitting = fastfile('ios').replace(
      'submit_for_review: false',
      'submit_for_review: true'
    );
    assert.ok(laneProblems('ios', submitting, '').some((p) => /metadata must not submit/.test(p)));
  });
});

describe('Android signs a release only with the keystore (REQ-MOB-008)', () => {
  const kts = read('apps/android/app/build.gradle.kts');

  it('REQ-MOB-008 the upload signing config reads the environment and is used only when configured', () => {
    assert.deepEqual(gradleSigningProblems(kts), []);
  });

  it('REQ-MOB-008 an unconditional or defaulted signing config fails', () => {
    const always = kts.replace(/if \(uploadSigning\) signingConfig/, 'signingConfig');
    assert.ok(gradleSigningProblems(always).some((p) => /only when it is configured/.test(p)));
    const defaulted = kts.replace(
      'System.getenv("TRAN_ANDROID_KEY_ALIAS")',
      'System.getenv("TRAN_ANDROID_KEY_ALIAS") ?: "upload"'
    );
    assert.deepEqual(gradleSigningProblems(defaulted), [
      'apps/android/app/build.gradle.kts: TRAN_ANDROID_KEY_ALIAS has a default',
    ]);
  });

  it('REQ-MOB-008 the GitHub release still builds the unsigned APK', () => {
    assert.match(
      read('.github/workflows/release.yml'),
      /:app:assembleRelease[^]*app-release-unsigned\.apk/
    );
  });
});

describe('the delivery workflow is manual, gated and pinned (REQ-MOB-009)', () => {
  const yaml = read('.github/workflows/mobile-release.yml');

  it('REQ-MOB-009 the real workflow passes every rule', () => {
    assert.deepEqual(workflowProblems(yaml), []);
    assert.deepEqual(workflowTriggers(yaml), ['workflow_dispatch']);
    assert.deepEqual(choiceOptions(yaml, 'lane'), LANES);
  });

  it('REQ-MOB-009 a pull_request or push trigger fails', () => {
    for (const trigger of ['pull_request', 'push', 'schedule']) {
      const changed = yaml.replace('on:\n', `on:\n  ${trigger}:\n`);
      assert.ok(
        workflowProblems(changed).some((p) => /only workflow_dispatch/.test(p)),
        trigger
      );
    }
  });

  it('REQ-MOB-009 an unpinned action, a literal credential or an ungated step fails', () => {
    const unpinned = yaml.replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v7');
    assert.ok(workflowProblems(unpinned).some((p) => /not pinned/.test(p)));
    const literal = yaml.replace(
      'TRAN_ASC_KEY_ID: ${{ secrets.TRAN_ASC_KEY_ID }}',
      'TRAN_ASC_KEY_ID: abc'
    );
    assert.ok(
      workflowProblems(literal).some((p) => /TRAN_ASC_KEY_ID is not read from a secret/.test(p))
    );
    const ungated = yaml.replace(
      "      - name: Install pnpm\n        if: steps.secrets.outputs.skip != 'true'\n",
      '      - name: Install pnpm\n'
    );
    assert.ok(workflowProblems(ungated).some((p) => /"Install pnpm" is not gated/.test(p)));
  });

  it('REQ-MOB-009 a gate that fails instead of skipping fails', () => {
    const failing = yaml.replace('echo "skip=true" >> "$GITHUB_OUTPUT"', 'exit 1');
    assert.ok(workflowProblems(failing).some((p) => /skip with a ::notice::/.test(p)));
  });
});

describe('scripts and CI', () => {
  const scripts = JSON.parse(read('package.json')).scripts;

  it('REQ-MOB-002 the lane, doctor and check scripts exist, quiet, and check:quick runs mobile:check', () => {
    assert.deepEqual(scriptProblems(scripts), []);
    assert.equal(scriptProblems({}).length, 9);
  });

  it('REQ-MOB-009 CI runs mobile:check next to secrets:check', () => {
    assert.match(
      read('.github/workflows/ci.yml'),
      /pnpm run secrets:check\n[^]*?pnpm run mobile:check/
    );
  });

  it('the whole repo passes checkAll', () => {
    assert.deepEqual(checkAll(ROOT), []);
  });
});
