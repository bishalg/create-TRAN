// Verifies: REQ-SEC-019 REQ-DB-011 REQ-DB-012
import Foundation
import Security

/// The session in the Keychain (REQ-SEC-019, ADR-0039 decision 4): one generic-password item
/// holding the refresh token, user id and role, readable after the first unlock, bound to this
/// device and never synchronised to iCloud. Security framework only, no library.
struct KeychainSessionVault: SessionVault {
    /// Failed Keychain write, with the `OSStatus` for diagnosis; it never carries the value.
    struct WriteFailed: Error, Equatable {
        let status: OSStatus
    }

    static let defaultService = "com.tran.voting.session"
    static let account = "api-session"

    let service: String

    init(service: String = KeychainSessionVault.defaultService) {
        self.service = service
    }

    /// Identifies the item; every query starts here.
    private var itemQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: Self.account,
        ]
    }

    func load() -> TranStoredSession? {
        var query = itemQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let data = result as? Data
        else { return nil }
        switch TranStoredSession.stored(data) {
        case .session(let session):
            // An older version is read into the current shape and not written back: a rewrite
            // (delete, then add) that failed halfway would lose the credential (REQ-DB-012).
            return session
        case .newer:
            // A newer app version wrote it: signed out here, left in place for that version.
            return nil
        case .unreadable:
            // Unreadable: delete it and treat as signed out (REQ-SEC-020).
            clear()
            return nil
        }
    }

    func save(_ session: TranStoredSession) throws {
        let data = try JSONEncoder().encode(session)
        // Delete then add, so the item always carries exactly these protection attributes.
        clear()
        var item = itemQuery
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        item[kSecAttrSynchronizable as String] = kCFBooleanFalse
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw WriteFailed(status: status) }
    }

    func clear() {
        var query = itemQuery
        // Also matches a synchronizable copy, should one ever have been written.
        query[kSecAttrSynchronizable as String] = kSecAttrSynchronizableAny
        SecItemDelete(query as CFDictionary)
    }
}
