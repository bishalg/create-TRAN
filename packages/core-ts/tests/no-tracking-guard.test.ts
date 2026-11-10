// Verifies: REQ-PRV-009
// The template does not track, and this proves it (spec 026, ADR-0043). A fork that tracks changes
// this guard in the same change, as docs/PERMISSIONS.md says.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

const PLAYBOOK = 'docs/PERMISSIONS.md#if-a-fork-needs-tracking';

/** What tracking looks like in the native projects, by what it is. */
const TRACKING: Record<string, RegExp> = {
  'App Tracking Transparency': /\bimport\s+AppTrackingTransparency\b|\bATTrackingManager\b/,
  'AdSupport (IDFA)': /\bimport\s+AdSupport\b|\bASIdentifierManager\b|\badvertisingIdentifier\b/,
  NSUserTrackingUsageDescription: /\bNSUserTrackingUsageDescription\b/,
  'the AD_ID permission': /\bcom\.google\.android\.gms\.permission\.AD_ID\b/,
  'an advertising id API':
    /\bAdvertisingIdClient\b|\bgetAdvertisingIdInfo\b|play-services-ads-identifier|\bandroidx\.ads\.identifier\b/,
  'tracking in the privacy manifest': /<key>NSPrivacyTracking<\/key>\s*<true\s*\/>/,
};

/** Native sources, project files and manifests, generated code included (a binding could import). */
const SCANNED = /\.(swift|kt|kts|xml|plist|xcprivacy|yml|yaml|toml|pbxproj)$/;
const SKIP = /^(build|\.gradle|DerivedData|RustLib|fastlane|node_modules)$/;

function files(dir: string): string[] {
  if (!existsSync(path.join(root, dir))) return [];
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.test(entry.name) ? [] : files(relative);
    return SCANNED.test(entry.name) ? [relative] : [];
  });
}

/** Line, block, XML, YAML and TOML comments removed: a comment is not code. */
function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .replace(/(^|\s)#\s.*$/gm, '$1');
}

/** `file: what` for every kind of tracking a file shows. */
function trackingFindings(sources: Record<string, string>): string[] {
  return Object.entries(sources).flatMap(([file, text]) => {
    const code = withoutComments(text);
    return Object.entries(TRACKING)
      .filter(([, pattern]) => pattern.test(code))
      .map(([what]) => `${file}: ${what}`);
  });
}

describe('the template does not track (REQ-PRV-009)', () => {
  it('has no tracking API, permission, usage string or manifest declaration in either app', () => {
    const scanned = [...files('apps/ios'), ...files('apps/android')];
    expect(scanned.length).toBeGreaterThan(20);
    const sources = Object.fromEntries(
      scanned.map((file) => [file, readFileSync(path.join(root, file), 'utf8')])
    );
    expect(
      trackingFindings(sources),
      `the template does not track; a fork that needs tracking follows ${PLAYBOOK}`
    ).toEqual([]);
  });

  it('points a failure at the playbook section that exists', () => {
    const playbook = readFileSync(path.join(root, 'docs/PERMISSIONS.md'), 'utf8');
    expect(playbook).toContain('## If a fork needs tracking');
  });

  it('finds every kind of tracking in a sample, and none in comments', () => {
    const samples: Record<string, string> = {
      'a/Ads.swift':
        'import AdSupport\nlet id = ASIdentifierManager.shared().advertisingIdentifier',
      'a/Prompt.swift':
        'import AppTrackingTransparency\nATTrackingManager.requestTrackingAuthorization { _ in }',
      'a/project.yml': 'info:\n  properties:\n    NSUserTrackingUsageDescription: Ads',
      'b/AndroidManifest.xml':
        '<uses-permission android:name="com.google.android.gms.permission.AD_ID" />',
      'b/Ads.kt': 'val info = AdvertisingIdClient.getAdvertisingIdInfo(context)',
      'b/build.gradle.kts':
        'implementation("com.google.android.gms:play-services-ads-identifier:18.0.1")',
      'a/PrivacyInfo.xcprivacy': '<key>NSPrivacyTracking</key>\n\t<true/>',
    };
    expect(trackingFindings(samples)).toEqual([
      'a/Ads.swift: AdSupport (IDFA)',
      'a/Prompt.swift: App Tracking Transparency',
      'a/project.yml: NSUserTrackingUsageDescription',
      'b/AndroidManifest.xml: the AD_ID permission',
      'b/Ads.kt: an advertising id API',
      'b/build.gradle.kts: an advertising id API',
      'a/PrivacyInfo.xcprivacy: tracking in the privacy manifest',
    ]);
    const clean: Record<string, string> = {
      'a/View.swift': '// No ASIdentifierManager here.\nimport SwiftUI',
      'b/AndroidManifest.xml':
        '<!-- never com.google.android.gms.permission.AD_ID -->\n<uses-permission android:name="android.permission.INTERNET" />',
      'a/project.yml': '# NSUserTrackingUsageDescription is not declared\nname: App',
      'a/PrivacyInfo.xcprivacy': '<key>NSPrivacyTracking</key>\n\t<false/>',
    };
    expect(trackingFindings(clean)).toEqual([]);
  });
});
