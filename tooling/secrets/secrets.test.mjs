// Verifies: REQ-SEC-001, REQ-SEC-002, REQ-SEC-003, REQ-MOB-004, REQ-MOB-005, REQ-DEP-002
// Sample tokens are built by concatenation so this file does not trip the scanner it tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyAllowlist,
  clientNames,
  codeEnvNames,
  compareEnv,
  credentialTestNames,
  DOCKER_CONTEXT_SECRETS,
  dockerBuildProblems,
  dockerIgnored,
  exampleKeys,
  isBinary,
  isLockfile,
  PUBLIC_BY_DESIGN,
  redact,
  scanByPath,
  scanFiles,
  scanText,
  secretLikeNames,
  ymlInfoProperties,
} from './secrets.mjs';

const read = (path) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const a36 = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

const SAMPLES = {
  'private-key': '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  'github-token': 'gh' + 'p_' + a36,
  'aws-access-key-id': 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
  'anthropic-key': 'sk-' + 'ant-api03-' + a36,
  'openai-key': 'sk-' + 'proj-' + a36 + 'abcdefgh',
  'stripe-key': 'sk_' + 'live_' + a36.slice(0, 26),
  'slack-token': 'xo' + 'xb-1234567890-abcdefghij',
  'google-api-key': 'AI' + 'za' + a36.slice(0, 35),
};

describe('secret scan (REQ-SEC-001)', () => {
  for (const [rule, sample] of Object.entries(SAMPLES)) {
    it(`REQ-SEC-001 finds a ${rule} with file, line and rule, never the value`, () => {
      const [finding, ...rest] = scanText('a.txt', `ok\nkey = "${sample}"\n`);
      assert.equal(rest.length, 0);
      assert.deepEqual([finding.file, finding.line, finding.rule], ['a.txt', 2, rule]);
      assert.ok(!JSON.stringify(finding).includes(sample));
    });
  }

  it('REQ-SEC-001 knows the legacy OpenAI and ASIA shapes and the fine-grained GitHub token', () => {
    const legacy = 'sk-' + 'abcdefghijklmnopqrst' + 'T3Blbk' + 'FJ' + 'abcdefghijklmnopqrst';
    assert.equal(scanText('a', legacy)[0].rule, 'openai-key');
    assert.equal(scanText('a', 'AS' + 'IA' + 'ABCDEFGHIJKLMNOP')[0].rule, 'aws-access-key-id');
    assert.equal(scanText('a', 'github' + '_pat_' + a36)[0].rule, 'github-token');
  });

  it('REQ-SEC-001 does not flag prose, short lookalikes or hashes', () => {
    const text = [
      'sk-learn and sk-ant',
      'ghp_short',
      'AKIA in prose',
      'sha512-' + a36.repeat(3),
      'xoxb',
      'task-based-estimation',
    ].join('\n');
    assert.deepEqual(scanText('a', text), []);
  });

  it('REQ-SEC-001 redacts to a prefix and a length', () => {
    assert.equal(redact('abcdefgh'), 'abcd…[8 chars]');
  });

  it('REQ-SEC-001 skips binary files and lockfiles', () => {
    const bytes = Buffer.concat([Buffer.from(SAMPLES['github-token']), Buffer.from([0])]);
    assert.ok(isBinary(bytes));
    assert.ok(
      isLockfile('pnpm-lock.yaml') && isLockfile('crates/Cargo.lock') && !isLockfile('a.ts')
    );
    const text = Buffer.from(SAMPLES['github-token']);
    const found = scanFiles({ 'x.bin': bytes, 'pnpm-lock.yaml': text, 'x.ts': text });
    assert.deepEqual(
      found.map((f) => f.file),
      ['x.ts']
    );
  });

  it('REQ-SEC-001 an allowlist entry suppresses its finding', () => {
    const findings = [{ file: 'a', line: 1, rule: 'github-token', redacted: '' }];
    const out = applyAllowlist(findings, [
      { file: 'a', rule: 'github-token', reason: 'a fixture' },
    ]);
    assert.deepEqual(out, { findings: [], problems: [] });
  });

  it('REQ-SEC-001 an entry without a reason, or one matching nothing, fails', () => {
    const findings = [{ file: 'a', line: 1, rule: 'github-token', redacted: '' }];
    const noReason = applyAllowlist(findings, [{ file: 'a', rule: 'github-token', reason: ' ' }]);
    assert.match(noReason.problems[0], /no reason/);
    const stale = applyAllowlist([], [{ file: 'a', rule: 'github-token', reason: 'old' }]);
    assert.match(stale.problems[0], /matches nothing/);
    const partial = applyAllowlist([], [{ file: 'a', rule: 'github-token', reason: 'old' }], {
      partial: true,
    });
    assert.deepEqual(partial.problems, []);
  });

  it('REQ-SEC-001 other rules or files stay reported despite an entry', () => {
    const findings = [{ file: 'b', line: 1, rule: 'github-token', redacted: '' }];
    const out = applyAllowlist(findings, [{ file: 'a', rule: 'github-token', reason: 'x' }]);
    assert.equal(out.findings.length, 1);
  });

  it('REQ-SEC-001 the committed allowlist is valid JSON and every entry has a reason', () => {
    const allow = JSON.parse(read('tooling/secrets/allow.json'));
    assert.ok(Array.isArray(allow));
    for (const entry of allow) assert.ok(entry.file && entry.rule && entry.reason);
  });

  it('REQ-SEC-001 the hook, check:quick and CI run the check', () => {
    assert.match(read('.githooks/pre-commit'), /secrets\.mjs --staged/);
    const scripts = JSON.parse(read('package.json')).scripts;
    assert.match(scripts['check:quick'], /pnpm secrets:check/);
    assert.match(
      scripts['secrets:check'],
      /secrets\.test\.mjs && node tooling\/secrets\/secrets\.mjs/
    );
    assert.match(read('.github/workflows/ci.yml'), /pnpm run secrets:check/);
  });

  it('REQ-SEC-001 .env files are ignored except .env.example', () => {
    const ignore = read('.gitignore');
    assert.match(ignore, /^\.env$/m);
    assert.match(ignore, /^!\.env\.example$/m);
  });
});

describe('env contract (REQ-SEC-002)', () => {
  it('REQ-SEC-002 collects keys, ignoring commented-out alternatives', () => {
    const { keys, problems } = exampleKeys('# Web\nA=1\n# note\nB=\n# HOST=0.0.0.0\n');
    assert.deepEqual(keys, ['A', 'B']);
    assert.deepEqual(problems, []);
  });

  it('REQ-SEC-002 a key with no comment above it in its section fails', () => {
    const { problems } = exampleKeys('# one\nA=1\n\nB=2\n');
    assert.deepEqual(problems, ['.env.example: B has no comment above it']);
  });

  it('REQ-SEC-002 reads API lookups, env::var, VITE_ and web process.env, not tests or tooling', () => {
    const names = codeEnvNames({
      'apps/api/src/config.rs': 'lookup("HOST") env::var("PORT") lookup(key)',
      'apps/api/src/other.rs': 'x.lookup( "APP_ENV" )',
      'apps/web/src/a.ts': 'import.meta.env.VITE_A; env.VITE_B; process.env.NODE_THING',
      'packages/core-ts/src/b.ts': 'import.meta.env.VITE_C',
      'apps/web/src/a.test.ts': 'import.meta.env.VITE_TEST_ONLY',
      'packages/create-tran/src/g.ts': 'process.env.CREATE_TRAN_TEMPLATE_URL',
      'tooling/x.mjs': 'process.env.CI',
    });
    assert.deepEqual(names, [
      'APP_ENV',
      'HOST',
      'NODE_THING',
      'PORT',
      'VITE_A',
      'VITE_B',
      'VITE_C',
    ]);
  });

  it('REQ-MOB-004 reads fastlane ENV and Gradle environment reads on the code side', () => {
    const names = codeEnvNames({
      'apps/ios/fastlane/Fastfile':
        'ENV["TRAN_A"] ENV.fetch("TRAN_B", "x") ENV.fetch( \'TRAN_C\' )',
      'apps/android/fastlane/Appfile': 'package_name(ENV.fetch("TRAN_D", "com.x"))',
      'apps/android/app/build.gradle.kts':
        'System.getenv("TRAN_E") ?: "x"; providers.environmentVariable("TRAN_F").orNull',
      'apps/android/settings.gradle.kts': 'System.getenv("TRAN_G")',
      'apps/ios/fastlane/README.md': 'ENV["NOT_CODE"]',
      'tooling/x.rb': 'ENV["NOT_APP"]',
    });
    assert.deepEqual(names, ['TRAN_A', 'TRAN_B', 'TRAN_C', 'TRAN_D', 'TRAN_E', 'TRAN_F', 'TRAN_G']);
  });

  it('REQ-SEC-002 fails in both directions, and RUST_LOG is read by a dependency', () => {
    assert.deepEqual(compareEnv(['A', 'B'], ['A', 'RUST_LOG']), [
      'B is read by code but missing from .env.example',
    ]);
    assert.deepEqual(compareEnv(['A'], ['A', 'Z']), ['Z is in .env.example but no code reads it']);
    // A variable only a switched-off live test reads is read (REQ-CODE-005).
    assert.deepEqual(compareEnv(['A'], ['A', 'Z'], ['Z']), []);
    assert.deepEqual(
      credentialTestNames({
        'apps/api/tests/live.rs':
          '#[ignore = "TODO(credentials): APNS_KEY_ID, Z_TOKEN - it sends"]',
        'b.ts': '// TODO(credentials): lower - not a marker',
      }),
      ['APNS_KEY_ID', 'Z_TOKEN']
    );
  });

  it('REQ-SEC-002 the real repo agrees with .env.example', () => {
    const example = exampleKeys(read('.env.example'));
    assert.deepEqual(example.problems, []);
    const code = codeEnvNames(
      Object.fromEntries(
        [
          'apps/api/src/config.rs',
          'apps/api/src/push/providers.rs',
          'apps/api/src/client_versions.rs',
          'apps/web/src/shared/api/apiUrl.ts',
          'apps/ios/fastlane/Fastfile',
          'apps/ios/fastlane/Appfile',
          'apps/android/fastlane/Fastfile',
          'apps/android/fastlane/Appfile',
          'apps/android/app/build.gradle.kts',
        ].map((path) => [path, read(path)])
      )
    );
    const live = credentialTestNames({
      api: read('apps/api/tests/push_live_test.rs'),
      ios: read('apps/ios/Tests/TranVotingDemoTests/ApnsRegistrationLiveTests.swift'),
      deploy: read('tooling/deploy/remote.test.mjs'),
    });
    assert.deepEqual(compareEnv(code, example.keys, live), []);
  });
});

describe('client-visible names (REQ-SEC-003)', () => {
  const bad = [
    'VITE_API_KEY',
    'VITE_APIKEY',
    'VITE_my_secret',
    'X_TOKEN',
    'DB_PASSWORD',
    'PRIVATE_X',
    'CREDENTIALS',
  ];

  it('REQ-SEC-003 flags secret-like names in any case, with or without the underscore', () => {
    const found = secretLikeNames(
      [...bad, 'VITE_TRAN_API_URL', 'TranApiBaseUrl'].map((name) => ({ source: 's', name }))
    );
    assert.deepEqual(
      found.map((f) => f.name),
      bad
    );
  });

  it('REQ-SEC-003 allows exactly the public Firebase API key name, nothing like it', () => {
    assert.deepEqual(PUBLIC_BY_DESIGN, ['TRAN_FCM_API_KEY']);
    const names = [
      'TRAN_FCM_API_KEY',
      'TRAN_FCM_API_KEY_2',
      'FCM_API_KEY',
      'tran_fcm_api_key',
      'TRAN_FCM_TOKEN',
    ];
    assert.deepEqual(
      secretLikeNames(names.map((name) => ({ source: 's', name }))).map((f) => f.name),
      names.slice(1)
    );
  });

  it('REQ-SEC-003 a VITE_ variable in .env.example or code is checked', () => {
    const names = clientNames({}, ['VITE_A_TOKEN', 'HOST'], ['VITE_B_SECRET', 'PORT']);
    assert.deepEqual(
      names.map((n) => n.name),
      ['VITE_A_TOKEN', 'VITE_B_SECRET']
    );
  });

  it('REQ-SEC-003 reads Android buildConfigField names', () => {
    const kts =
      'buildConfigField("String", "SERVER_TOKEN", "\\"x\\"")\nbuildConfigField("String", "TRAN_API", "")';
    const names = clientNames(
      { 'apps/android/app/build.gradle.kts': kts, 'other/build.gradle.kts': kts },
      [],
      []
    );
    assert.deepEqual(
      names.map((n) => n.name),
      ['SERVER_TOKEN', 'TRAN_API']
    );
    assert.equal(secretLikeNames(names).length, 1);
  });

  it('REQ-SEC-003 reads custom iOS Info.plist keys and skips Apple standard ones', () => {
    const plist =
      '<key>CFBundleName</key><key>NSFoo</key><key>UILaunchScreen</key><key>LSX</key><key>ApiKey</key>';
    const names = clientNames({ 'apps/ios/Support/Info.plist': plist }, [], []);
    assert.deepEqual(
      names.map((n) => n.name),
      ['ApiKey']
    );
    assert.equal(secretLikeNames(names).length, 1);
  });

  it('REQ-SEC-003 reads custom project.yml info.properties keys only', () => {
    const yml = [
      'targets:',
      '  App:',
      '    info:',
      '      properties:',
      '        CFBundleName: x',
      '        NSAppTransportSecurity:',
      '          NSAllowsLocalNetworking: true',
      '        ServerSecret: abc',
      '    settings:',
      '      Other_Token: 1',
    ].join('\n');
    assert.deepEqual(
      ymlInfoProperties(yml).map((n) => n.name),
      ['ServerSecret']
    );
    assert.equal(clientNames({ 'apps/ios/project.yml': yml }, [], []).length, 1);
  });

  it('REQ-SEC-003 the real client config has no secret-like name', () => {
    const files = {
      'apps/ios/Support/Info.plist': read('apps/ios/Support/Info.plist'),
      'apps/ios/project.yml': read('apps/ios/project.yml'),
    };
    const example = exampleKeys(read('.env.example')).keys;
    assert.deepEqual(secretLikeNames(clientNames(files, [], example)), []);
  });
});

describe('signing material (REQ-MOB-005)', () => {
  const buf = (text) => Buffer.from(text);
  const team = 'A1B2C3' + 'D4E5';

  it('REQ-MOB-005 a tracked .p8, .p12, .mobileprovision, .jks or .keystore fails, whatever it holds', () => {
    const files = [
      'AuthKey.p8',
      'dist.P12',
      'a/App.mobileprovision',
      'upload.jks',
      'release.keystore',
    ];
    const found = scanFiles(Object.fromEntries(files.map((f) => [f, Buffer.from([0, 1, 2])])));
    assert.deepEqual(
      found.map((f) => [f.file, f.rule]),
      files.map((f) => [f, 'signing-file'])
    );
    assert.deepEqual(scanFiles({ 'p8.txt': buf('x'), 'keystore.md': buf('x') }), []);
  });

  it('REQ-MOB-005 a Google service-account key fails in any .json, never in prose', () => {
    const key = '{\n  "type"' + ': "service_' + 'account",\n  "project_id": "x"\n}';
    const [finding, ...rest] = scanFiles({ 'play.json': buf(key), 'notes.md': buf(key) });
    assert.equal(rest.length, 0);
    assert.deepEqual(
      [finding.file, finding.line, finding.rule],
      ['play.json', 2, 'google-service-account']
    );
  });

  it('REQ-MOB-005 a literal team id or key id in a Fastfile, Appfile or project.yml fails', () => {
    const cases = [
      ['apps/ios/fastlane/Appfile', `team_id("${team}")`],
      ['apps/ios/fastlane/Fastfile', `  app_store_connect_api_key(key_id: "${team}")`],
      ['apps/ios/fastlane/Fastfile', `build_app(export_team_id: '${team}')`],
      ['apps/ios/project.yml', `        DEVELOPMENT_TEAM: ${team}`],
      ['apps/ios/project.yml', `        "DEVELOPMENT_TEAM": "${team}"`],
      ['apps/android/fastlane/Fastfile', `itc_team_id ${team}`],
    ];
    for (const [file, line] of cases) {
      const [finding] = scanByPath(file, `# ok\n${line}\n`);
      assert.deepEqual([finding?.line, finding?.rule], [2, 'apple-identifier'], `${file}: ${line}`);
      assert.ok(!JSON.stringify(finding).includes(team));
    }
  });

  it('REQ-MOB-005 environment reads, placeholders and other files are not flagged', () => {
    const ok = [
      ['apps/ios/fastlane/Appfile', 'team_id(ENV["TRAN_APPLE_TEAM_ID"])'],
      ['apps/ios/fastlane/Fastfile', 'key_id: ENV["TRAN_ASC_KEY_ID"], "DEVELOPMENT_TEAM=#{x}"'],
      ['apps/ios/project.yml', '        DEVELOPMENT_TEAM: $(TRAN_TEAM)'],
      ['apps/ios/project.yml', '        DEVELOPMENT_TEAM: ABCDEFGHIJ'],
      ['docs/MOBILE_RELEASE.md', `team_id("${team}")`],
    ];
    for (const [file, line] of ok) assert.deepEqual(scanByPath(file, line), [], `${file}: ${line}`);
  });

  it('REQ-MOB-005 .gitignore lists the same signing files', () => {
    const ignore = read('.gitignore');
    for (const ext of ['p8', 'p12', 'mobileprovision', 'jks', 'keystore'])
      assert.match(ignore, new RegExp(`^\\*\\.${ext}$`, 'm'), ext);
  });
});

describe('the image build context and recipe hold no secret (REQ-DEP-002)', () => {
  it('REQ-DEP-002 Docker rules: last match wins, folders cover their contents, ! re-includes', () => {
    const rules = '*\n!apps/api/\n**/*.pem\n!apps/api/keep.pem\n';
    assert.equal(dockerIgnored(rules, 'docs/a.md'), true);
    assert.equal(dockerIgnored(rules, 'apps/api/src/main.rs'), false);
    assert.equal(dockerIgnored(rules, 'apps/api/deep/x.pem'), true);
    assert.equal(dockerIgnored(rules, 'apps/api/keep.pem'), false);
    assert.equal(
      dockerIgnored('.env*\n', 'apps/api/.env'),
      false,
      'a root pattern stays at the root'
    );
    assert.equal(dockerIgnored('**/.env*\n', 'apps/api/.env'), true);
  });

  it('REQ-DEP-002 root-only patterns let a nested key or env file through', () => {
    const rootOnly =
      '.git\n.env*\ndata/\n*.pem\n*.p8\n*.key\n*.p12\n*.jks\n*.keystore\n*.mobileprovision\n';
    const problems = dockerBuildProblems(rootOnly, '');
    assert.ok(
      problems.includes(
        '.dockerignore: apps/api/certs/server.pem would enter the image build context'
      )
    );
    assert.ok(
      problems.includes('.dockerignore: apps/api/.env would enter the image build context')
    );
    assert.ok(!problems.some((p) => p.includes(': .env ')));
  });

  it('REQ-DEP-002 a secret-like ARG or ENV in the Dockerfile fails', () => {
    assert.deepEqual(dockerBuildProblems('*\n', 'ARG VERSION\nENV DB_PASSWORD=x\nARG apiKey\n'), [
      'apps/api/Dockerfile:2: ENV DB_PASSWORD looks like a secret',
      'apps/api/Dockerfile:3: ARG apiKey looks like a secret',
    ]);
  });

  it('REQ-DEP-002 the real .dockerignore and Dockerfile pass, for every sample path', () => {
    assert.ok(DOCKER_CONTEXT_SECRETS.length >= 10);
    assert.deepEqual(dockerBuildProblems(read('.dockerignore'), read('apps/api/Dockerfile')), []);
  });
});
