import Foundation
import Security
import LocalAuthentication

/// Enterprise Keychain and Biometric Access wrapper.
/// Inspired by `protonpass/ios-pass` (`LocalPackages/Core`) and `bitwarden/ios` (`BitwardenShared`).
public final class KeychainHelper: Sendable {
    private let service: String
    private let accessGroup: String?

    public init(
        service: String = Bundle.main.bundleIdentifier ?? "org.tran.keychain",
        accessGroup: String? = nil
    ) {
        self.service = service
        self.accessGroup = accessGroup
    }

    // MARK: - Generic Password Storage

    /// Saves or updates data in the Keychain with optional biometric protection
    public func set(_ data: Data, forKey key: String, requireBiometrics: Bool = false) throws {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]

        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }

        if requireBiometrics {
            var error: Unmanaged<CFError>?
            guard let accessControl = SecAccessControlCreateWithFlags(
                kCFAllocatorDefault,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                .biometryAny,
                &error
            ) else {
                let err = error?.takeRetainedValue()
                throw KeychainError.accessControlCreationFailed(err?.localizedDescription ?? "Unknown")
            }
            query[kSecAttrAccessControl as String] = accessControl
        } else {
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        }

        // Delete any existing item to ensure update succeeds cleanly
        SecItemDelete(query as CFDictionary)

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.osStatus(status)
        }
    }

    /// Convenience for saving UTF-8 strings
    public func setString(_ value: String, forKey key: String, requireBiometrics: Bool = false) throws {
        guard let data = value.data(using: .utf8) else {
            throw KeychainError.encodingFailed
        }
        try set(data, forKey: key, requireBiometrics: requireBiometrics)
    }

    /// Retrieves data from Keychain with optional biometric prompt
    public func getData(forKey key: String, prompt: String? = nil) throws -> Data {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }

        if let prompt {
            query[kSecUseOperationPrompt as String] = prompt
        }

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status != errSecItemNotFound else {
            throw KeychainError.itemNotFound
        }

        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError.osStatus(status)
        }

        return data
    }

    /// Convenience for reading UTF-8 strings
    public func getString(forKey key: String, prompt: String? = nil) throws -> String {
        let data = try getData(forKey: key, prompt: prompt)
        guard let string = String(data: data, encoding: .utf8) else {
            throw KeychainError.decodingFailed
        }
        return string
    }

    /// Deletes an item from the Keychain
    public func delete(forKey key: String) throws {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.osStatus(status)
        }
    }

    /// Checks if a key exists without reading its payload
    public func contains(key: String) -> Bool {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }
}

// MARK: - Keychain Errors

public enum KeychainError: LocalizedError, Sendable {
    case itemNotFound
    case encodingFailed
    case decodingFailed
    case accessControlCreationFailed(String)
    case osStatus(OSStatus)

    public var errorDescription: String? {
        switch self {
        case .itemNotFound: "Requested item was not found in the Keychain."
        case .encodingFailed: "Failed to encode string into UTF-8 data."
        case .decodingFailed: "Failed to decode Keychain data into UTF-8 string."
        case .accessControlCreationFailed(let msg): "Failed to create biometric access control: \(msg)"
        case .osStatus(let code): "Keychain operation failed with OSStatus \(code)."
        }
    }
}
