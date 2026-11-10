// Verifies: REQ-SEC-019
import Security
import XCTest

/// The real Keychain, in the simulator's test host: one generic-password item, device-only,
/// readable after first unlock, never synchronised. Uses its own service name, so it never
/// touches the app's session.
final class KeychainSessionVaultTests: XCTestCase {
    private let vault = KeychainSessionVault(service: "com.tran.voting.session.tests")

    override func setUpWithError() throws {
        try super.setUpWithError()
        vault.clear()
        // A host without a Keychain (no entitlement) cannot run this suite; say so, do not pass.
        do {
            try vault.save(SessionWire.stored())
        } catch let failure as KeychainSessionVault.WriteFailed where failure.status == errSecMissingEntitlement {
            throw XCTSkip("this test host has no Keychain access (errSecMissingEntitlement)")
        }
        vault.clear()
    }

    override func tearDown() {
        vault.clear()
        super.tearDown()
    }

    /// Every item the vault's service owns, with its attributes.
    private func items() -> [[String: Any]] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: vault.service,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return [] }
        return result as? [[String: Any]] ?? []
    }

    func testSavesLoadsAndClearsOneSession() throws {
        XCTAssertNil(vault.load())

        try vault.save(SessionWire.stored(refresh: "refresh-1"))
        XCTAssertEqual(vault.load(), SessionWire.stored(refresh: "refresh-1"))

        vault.clear()
        XCTAssertNil(vault.load())
        XCTAssertTrue(items().isEmpty)
        vault.clear()  // safe to repeat
    }

    func testARotationReplacesTheItemInsteadOfAddingOne() throws {
        try vault.save(SessionWire.stored(refresh: "refresh-1"))
        try vault.save(SessionWire.stored(refresh: "refresh-2", role: "election_auditor"))

        XCTAssertEqual(items().count, 1)
        XCTAssertEqual(vault.load(), SessionWire.stored(refresh: "refresh-2", role: "election_auditor"))
    }

    func testTheItemIsDeviceOnlyAfterFirstUnlockAndNotSynchronised() throws {
        try vault.save(SessionWire.stored())

        let item = try XCTUnwrap(items().first)
        XCTAssertEqual(
            item[kSecAttrAccessible as String] as? String,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        XCTAssertEqual((item[kSecAttrSynchronizable as String] as? NSNumber)?.boolValue ?? false, false)
        XCTAssertEqual(item[kSecAttrAccount as String] as? String, KeychainSessionVault.account)
    }

    func testAnUnreadableItemIsDeletedAndTreatedAsSignedOut() throws {
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: vault.service,
            kSecAttrAccount as String: KeychainSessionVault.account,
            kSecValueData as String: Data("not json".utf8),
        ]
        XCTAssertEqual(SecItemAdd(item as CFDictionary, nil), errSecSuccess)

        XCTAssertNil(vault.load())
        XCTAssertTrue(items().isEmpty)
    }
}
