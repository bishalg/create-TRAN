// Verifies: REQ-PSH-010 REQ-PSH-012
// Who may touch push on each platform, and that no app derives anything from hardware (spec 027,
// ADR-0044). It reads native files, so it lives with the other guards here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

/**
 * The only file per platform that may register for push and receive tokens (REQ-PSH-012). The
 * notification permission itself is asked by `Permissions/SystemPermissionGateway`
 * (permission-declarations.test.ts); everything else goes through the push gateway's protocol or
 * interface, and tests use a fake.
 */
const PUSH_GATEWAYS = {
  ios: 'apps/ios/Sources/TranVotingDemo/Push/SystemPushGateway.swift',
  android: 'apps/android/app/src/main/kotlin/com/tran/voting/push/SystemPushGateway.kt',
} as const;

/** Token registration and delivery APIs: APNs registration and its delegate; Firebase messaging. */
const PUSH_REGISTRATION_APIS = {
  ios: /\b(?:un)?registerForRemoteNotifications\b|\bdidRegisterForRemoteNotificationsWithDeviceToken\b|\bdidFailToRegisterForRemoteNotificationsWithError\b|\bUNUserNotificationCenterDelegate\b/,
  android:
    /\bFirebaseMessaging(?:Service)?\b|\bFirebaseApp\b|\bFirebaseOptions\b|\bonNewToken\b|\bcom\.google\.firebase\b/,
} as const;

/** Hardware identifiers no app may read: the installation id is a random UUID (REQ-PSH-010). */
const HARDWARE_IDENTIFIERS = {
  ios: /\bidentifierForVendor\b|\buniqueIdentifier\b|\bmacAddress\b/,
  android:
    /\bANDROID_ID\b|\bSettings\.Secure\b|\bBuild\.(?:SERIAL|getSerial)\b|\bgetSerial\s*\(|\b(?:getMacAddress|macAddress|getHardwareAddress|hardwareAddress)\b|\bget(?:Imei|Meid|DeviceId)\s*\(/,
} as const;

const SKIP = /^(build|\.gradle|DerivedData|RustLib|Generated|generated|uniffi)$/;

function files(dir: string, extension: string): string[] {
  if (!existsSync(path.join(root, dir))) return [];
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.test(entry.name) ? [] : files(relative, extension);
    return entry.name.endsWith(extension) ? [relative] : [];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Files other than `allowed` whose code (comments aside) matches `api`. */
function callers(sources: Record<string, string>, api: RegExp, allowed?: string): string[] {
  return Object.entries(sources)
    .filter(([file, text]) => file !== allowed && api.test(withoutComments(text)))
    .map(([file]) => file);
}

function read(files: string[]): Record<string, string> {
  return Object.fromEntries(files.map((f) => [f, readFileSync(path.join(root, f), 'utf8')]));
}

const appSources = {
  ios: read(files('apps/ios/Sources', '.swift')),
  android: read(files('apps/android/app/src/main', '.kt')),
};

describe('only the push gateway registers for push (REQ-PSH-012)', () => {
  it.each(['ios', 'android'] as const)('%s registers only in its gateway', (os) => {
    expect(Object.keys(appSources[os]).length).toBeGreaterThan(5);
    expect(
      callers(appSources[os], PUSH_REGISTRATION_APIS[os], PUSH_GATEWAYS[os]),
      `move the call into ${PUSH_GATEWAYS[os]}`
    ).toEqual([]);
    const gateway = PUSH_GATEWAYS[os];
    if (existsSync(path.join(root, gateway))) {
      expect(PUSH_REGISTRATION_APIS[os].test(read([gateway])[gateway]!), gateway).toBe(true);
    }
  });

  it('notices registration outside the gateway, and not in a comment', () => {
    const swift = {
      'a/App.swift': 'UIApplication.shared.registerForRemoteNotifications()',
      'a/Delegate.swift': 'final class D: NSObject, UNUserNotificationCenterDelegate {}',
      'a/Note.swift': '// registerForRemoteNotifications lives in the gateway',
      'a/Center.swift': 'UNUserNotificationCenter.current().removeAllDeliveredNotifications()',
      [PUSH_GATEWAYS.ios]: 'UIApplication.shared.registerForRemoteNotifications()',
    };
    expect(callers(swift, PUSH_REGISTRATION_APIS.ios, PUSH_GATEWAYS.ios)).toEqual([
      'a/App.swift',
      'a/Delegate.swift',
    ]);
    const kotlin = {
      'b/Token.kt': 'FirebaseMessaging.getInstance().token.addOnCompleteListener {}',
      'b/Service.kt':
        'class S : FirebaseMessagingService() { override fun onNewToken(t: String) {} }',
      'b/Init.kt': 'import com.google.firebase.FirebaseApp',
      'b/Plain.kt': '/* FirebaseMessaging */ val x = 1',
    };
    expect(callers(kotlin, PUSH_REGISTRATION_APIS.android, PUSH_GATEWAYS.android)).toEqual([
      'b/Token.kt',
      'b/Service.kt',
      'b/Init.kt',
    ]);
  });
});

describe('no app reads a hardware identifier (REQ-PSH-010)', () => {
  it.each(['ios', 'android'] as const)('%s app code names none', (os) => {
    expect(callers(appSources[os], HARDWARE_IDENTIFIERS[os])).toEqual([]);
  });

  it('finds each kind of hardware identifier in a sample', () => {
    const swift = {
      'a/Vendor.swift': 'let id = UIDevice.current.identifierForVendor',
      'a/Random.swift': 'let id = UUID().uuidString',
    };
    expect(callers(swift, HARDWARE_IDENTIFIERS.ios)).toEqual(['a/Vendor.swift']);
    const kotlin = {
      'b/Id.kt': 'Settings.Secure.getString(resolver, Settings.Secure.ANDROID_ID)',
      'b/Serial.kt': 'val s = Build.getSerial()',
      'b/Old.kt': 'val s = Build.SERIAL',
      'b/Mac.kt': 'val m = wifiInfo.macAddress',
      'b/Nic.kt': 'val m = nic.hardwareAddress',
      'b/Imei.kt': 'val i = telephony.getImei()',
      'b/Random.kt': 'val id = UUID.randomUUID().toString()',
    };
    expect(callers(kotlin, HARDWARE_IDENTIFIERS.android)).toEqual([
      'b/Id.kt',
      'b/Serial.kt',
      'b/Old.kt',
      'b/Mac.kt',
      'b/Nic.kt',
      'b/Imei.kt',
    ]);
  });
});
