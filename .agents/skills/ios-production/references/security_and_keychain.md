# Security & Keychain Guide

This guide establishes the enterprise security standards for iOS applications, inspired by **Proton Pass (`LocalPackages/Core`)** and **Bitwarden (`BitwardenShared/Core/Platform/Utilities`)**. It covers secure credential storage, hardware-backed Secure Enclave operations, biometric authorization, clipboard hygiene, and privacy overlays.

---

## 1. Enterprise Keychain Storage

`UserDefaults` is plaintext and backed by a property list stored on the filesystem. Any token, secret key, or user credential must be stored in the iOS Keychain with strict accessibility attributes.

### Accessibility Attributes
- **`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`** (Default): Data is encrypted until the user unlocks their device once after reboot. It does not sync to iCloud Keychain, preventing remote exfiltration.
- **`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`**: Data is accessible only while the device is actively unlocked. Use for high-value signing keys.

### Keychain Wrapper Protocol
```swift
import Foundation
import Security

public protocol SecureStorageProtocol: Sendable {
    func store(key: String, data: Data, requireBiometrics: Bool) throws
    func retrieve(key: String, promptMessage: String?) throws -> Data
    func delete(key: String) throws
    func contains(key: String) -> Bool
}
```

---

## 2. Biometric Protection (Face ID / Touch ID)

When storing high-value cryptographic keys or voting credentials, configure access control flags to mandate user presence:

```swift
import LocalAuthentication
import Security

public enum SecurityError: LocalizedError, Sendable {
    case itemNotFound
    case duplicateItem
    case accessControlFailed
    case biometricsFailed(String)
    case unhandledStatus(OSStatus)

    public var errorDescription: String? {
        switch self {
        case .itemNotFound: "Item not found in Keychain"
        case .duplicateItem: "Item already exists in Keychain"
        case .accessControlFailed: "Failed to create biometric access control"
        case .biometricsFailed(let msg): "Biometric authentication failed: \(msg)"
        case .unhandledStatus(let status): "Keychain returned OSStatus: \(status)"
        }
    }
}

public final class KeychainManager: SecureStorageProtocol {
    private let service: String

    public init(service: String = Bundle.main.bundleIdentifier ?? "com.app.keychain") {
        self.service = service
    }

    public func store(key: String, data: Data, requireBiometrics: Bool = false) throws {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]

        if requireBiometrics {
            var error: Unmanaged<CFError>?
            guard let accessControl = SecAccessControlCreateWithFlags(
                kCFAllocatorDefault,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                .biometryAny,
                &error
            ) else {
                throw SecurityError.accessControlFailed
            }
            query[kSecAttrAccessControl as String] = accessControl
        } else {
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        }

        // Delete any existing item first to avoid errSecDuplicateItem
        SecItemDelete(query as CFDictionary)

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw SecurityError.unhandledStatus(status)
        }
    }

    public func retrieve(key: String, promptMessage: String? = nil) throws -> Data {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        if let promptMessage {
            query[kSecUseOperationPrompt as String] = promptMessage
        }

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status != errSecItemNotFound else { throw SecurityError.itemNotFound }
        guard status == errSecSuccess, let data = result as? Data else {
            throw SecurityError.unhandledStatus(status)
        }
        return data
    }

    public func delete(key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecurityError.unhandledStatus(status)
        }
    }

    public func contains(key: String) -> Bool {
        (try? retrieve(key: key)) != nil
    }
}
```

---

## 3. Secure Pasteboard with Auto-Expiration

Sensitive values (such as secret recovery phrases, cryptographic hashes, or passwords) should never linger indefinitely on the system clipboard.

```swift
import UIKit

public struct SecureClipboard {
    /// Copies sensitive text to the clipboard and automatically invalidates it after a timeout
    public static func copySensitive(_ text: String, timeout: TimeInterval = 60.0) {
        let pasteboard = UIPasteboard.general
        let expireDate = Date().addingTimeInterval(timeout)

        pasteboard.setItems(
            [[UIPasteboard.typeListString[0] as String: text]],
            options: [
                .expirationDate: expireDate,
                .localOnly: true // Prevents Universal Clipboard sync to macOS/iPadOS
            ]
        )
    }
}
```

---

## 4. App-Switcher Privacy Protection

iOS captures screenshots of the app window when backgrounding to display in the App Switcher. If sensitive identity or voting information is visible, this screenshot poses a security leak.

### Privacy Blur ViewModifier
```swift
import SwiftUI

public struct PrivacyBlurModifier: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase

    public func body(content: Content) -> some View {
        content
            .blur(radius: scenePhase != .active ? 16 : 0)
            .animation(.easeInOut(duration: 0.2), value: scenePhase)
    }
}

public extension View {
    func hideInAppSwitcher() -> some View {
        modifier(PrivacyBlurModifier())
    }
}
```
