// Verifies: REQ-NAT-011
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

const ANDROID_CLIENT = 'apps/android/app/src/main/kotlin/com/tran/voting/api/TranApiClient.kt';
const IOS_CLIENT = 'apps/ios/Sources/TranVotingDemo/Api/TranApiClient.swift';

function read(relative: string): string {
  return readFileSync(path.join(root, relative), 'utf8');
}

function listFiles(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'Generated' || entry.name === 'generated'
        ? []
        : listFiles(full, extension);
    }
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

describe('native API clients (dialect: config, cleartext, debug header)', () => {
  it('gives Android the INTERNET permission and keeps cleartext in the debug overlay', () => {
    const manifest = read('apps/android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android.permission.INTERNET');
    expect(manifest).not.toMatch(/usesCleartextTraffic/);
    expect(manifest).not.toMatch(/networkSecurityConfig/);

    const debugManifest = read('apps/android/app/src/debug/AndroidManifest.xml');
    expect(debugManifest).toMatch(/android:networkSecurityConfig="@xml\/network_security_config"/);
    expect(debugManifest).not.toMatch(/usesCleartextTraffic/);

    const config = read('apps/android/app/src/debug/res/xml/network_security_config.xml');
    const domains = [...config.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)]
      .map((match) => match[1])
      .sort();
    expect(domains).toEqual(['10.0.2.2', '127.0.0.1', 'localhost']);
    expect(config).toMatch(/<domain-config cleartextTrafficPermitted="true">/);
    expect(config).toMatch(/<base-config cleartextTrafficPermitted="false"/);

    // The release build has no overlay, so it inherits the platform default (cleartext blocked).
    expect(() => read('apps/android/app/src/release/AndroidManifest.xml')).toThrow();
  });

  it('makes the Android base URL configurable with emulator and HTTPS defaults', () => {
    const gradle = read('apps/android/app/build.gradle.kts');
    expect(gradle).toMatch(/findProperty\("tranApiBaseUrl"\)/);
    expect(gradle).toMatch(/System\.getenv\("TRAN_API_BASE_URL"\)/);
    expect(gradle).toMatch(/buildConfig = true/);
    expect([
      ...gradle.matchAll(/buildConfigField\(\s*"String",\s*"TRAN_API_BASE_URL",/g),
    ]).toHaveLength(2);
    expect(gradle).toContain('http://10.0.2.2:3001');
    expect(gradle).toContain('https://api.tran.example');
  });

  it('exempts only loopback on iOS, never ATS wholesale', () => {
    const project = read('apps/ios/project.yml');
    expect(project).toMatch(/TranApiBaseUrl: \$\(TRAN_API_BASE_URL\)/);
    expect(project).toMatch(/NSAllowsLocalNetworking: true/);
    expect(project).toMatch(/TRAN_API_BASE_URL: http:\/\/127\.0\.0\.1:3001/);
    expect(project).not.toMatch(/NSAllowsArbitraryLoads/);

    // The generated plist (committed, rebuilt by `pnpm ios:project`) carries the same wiring.
    const plist = read('apps/ios/Support/Info.plist');
    expect(plist).toMatch(/<key>TranApiBaseUrl<\/key>\s*<string>\$\(TRAN_API_BASE_URL\)<\/string>/);
    expect(plist).toMatch(/<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/);
    expect(plist).not.toMatch(/NSAllowsArbitraryLoads/);
  });

  it('keeps X-Debug-Country inside the two clients, behind debug gates', () => {
    const carriers = [
      ...listFiles(path.join(root, 'apps/ios/Sources'), '.swift'),
      ...listFiles(path.join(root, 'apps/android/app/src/main/kotlin'), '.kt'),
    ]
      .filter((file) => readFileSync(file, 'utf8').includes('X-Debug-Country'))
      .map((file) => path.relative(root, file))
      .sort();

    expect(carriers).toEqual([ANDROID_CLIENT, IOS_CLIENT]);
    expect(read(IOS_CLIENT)).toMatch(/#if DEBUG/);
    expect(read(ANDROID_CLIENT)).toMatch(/BuildConfig\.DEBUG/);
  });
});
