// Verifies: REQ-DB-011 REQ-DB-012
import Security
import XCTest

/// `fixtures/stored-records.json` through the stores the app really reads: every kept record is
/// written as the stored item (a Keychain item, `UserDefaults` values, the config cache) and read
/// back by `KeychainSessionVault`, `TranPushStore` and `RemoteConfigStore`. Each case says what
/// the store hands back and whether the stored record is still there afterwards.
final class StoredRecordTests: XCTestCase {
    private struct RecordCase {
        let name: String
        let raw: [String: Any]
        let expected: [String: Any]?
        let kept: Bool
    }

    private static let fixture: [String: Any] = {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let data = try! Data(contentsOf: repoRoot.appendingPathComponent("fixtures/stored-records.json"))
        return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    }()

    private func cases(_ kind: String) throws -> [RecordCase] {
        let records = try XCTUnwrap(Self.fixture["records"] as? [String: Any])
        let rows = try XCTUnwrap(records[kind] as? [[String: Any]])
        XCTAssertFalse(rows.isEmpty, kind)
        return try rows.map {
            RecordCase(
                name: try XCTUnwrap($0["name"] as? String),
                raw: try XCTUnwrap($0["raw"] as? [String: Any]),
                expected: $0["expected"] as? [String: Any],
                kept: try XCTUnwrap($0["kept"] as? Bool))
        }
    }

    private func freshDefaults() -> (UserDefaults, String) {
        let suite = "stored-records-\(UUID().uuidString)"
        return (UserDefaults(suiteName: suite)!, suite)
    }

    // MARK: - Decisions

    func testCurrentSchemasMatchFixture() throws {
        let schemas = try XCTUnwrap(Self.fixture["currentSchemas"] as? [String: Int])
        XCTAssertEqual(Int(tranStoredSessionSchema()), schemas["session"])
        XCTAssertEqual(Int(tranStoredPushSchema()), schemas["push"])
        XCTAssertEqual(Int(tranStoredConfigSchema()), schemas["config"])
    }

    func testStoredRecordDecisionsMatchFixture() throws {
        let cases = try XCTUnwrap(Self.fixture["decisions"] as? [[String: Any]])
        for c in cases {
            let label = try XCTUnwrap(c["name"] as? String)
            let schema = try XCTUnwrap(UInt32(exactly: try XCTUnwrap(c["schema"] as? Int)))
            let current = try XCTUnwrap(UInt32(exactly: try XCTUnwrap(c["current"] as? Int)))
            let action: String
            switch tranStoredRecordDecision(schema: schema, current: current) {
            case .use: action = "use"
            case .upgrade: action = "upgrade"
            case .discard: action = "discard"
            }
            XCTAssertEqual(action, c["action"] as? String, label)
        }
    }

    func testTheSchemaRuleNeverTraps() {
        XCTAssertEqual(TranStoredSchema.version(nil), 1)
        XCTAssertEqual(TranStoredSchema.version(NSNumber(value: 2)), 2)
        XCTAssertEqual(TranStoredSchema.version(NSNumber(value: UInt32.max)), UInt32.max)
        for bad: Any in [
            "2", NSNumber(value: -1), NSNumber(value: 1.5), NSNumber(value: 2.0), NSNumber(value: 0),
            NSNumber(value: Int64(UInt32.max) + 1), NSNumber(value: Int64.min), NSNumber(value: UInt64.max),
            NSNumber(value: true), NSNull(), [2],
        ] {
            XCTAssertNil(TranStoredSchema.version(bad), "\(bad)")
        }
    }

    // MARK: - Session, through the real Keychain vault

    private let vault = KeychainSessionVault(service: "com.tran.voting.session.stored-records-tests")

    /// The bytes of the vault's one item, or `nil`.
    private func storedItem() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: vault.service,
            kSecAttrAccount as String: KeychainSessionVault.account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    /// Writes `bytes` as the vault's item, the way an earlier release left it.
    private func storeItem(_ bytes: Data) throws {
        vault.clear()
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: vault.service,
            kSecAttrAccount as String: KeychainSessionVault.account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: bytes,
        ]
        let status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecMissingEntitlement {
            throw XCTSkip("this test host has no Keychain access (errSecMissingEntitlement)")
        }
        XCTAssertEqual(status, errSecSuccess)
    }

    override func tearDown() {
        vault.clear()
        super.tearDown()
    }

    func testEveryKeptSessionRecordReadsThroughTheKeychainVault() throws {
        for c in try cases("session") {
            let bytes = try JSONSerialization.data(withJSONObject: c.raw)
            try storeItem(bytes)

            let loaded = vault.load()

            if let expected = c.expected {
                let session = try XCTUnwrap(loaded, "\(c.name): signed in")
                XCTAssertEqual(session.schema, expected["schema"] as? Int, c.name)
                XCTAssertEqual(session.userId, expected["userId"] as? String, c.name)
                XCTAssertEqual(session.roleWire, expected["role"] as? String, c.name)
                XCTAssertEqual(session.refreshToken, expected["refreshToken"] as? String, c.name)
            } else {
                XCTAssertNil(loaded, "\(c.name): signed out")
            }
            // Reading never rewrites: the item is the same bytes, or gone when unreadable.
            XCTAssertEqual(storedItem(), c.kept ? bytes : nil, "\(c.name): stored afterwards")
        }
    }

    /// The exact item the release before versioning wrote (`JSONEncoder`, no `schema`): signed in.
    func testThePreviousReleaseItemKeepsThePersonSignedIn() throws {
        let legacy = Data(#"{"refresh_token":"rt-legacy","user_id":"voter-001","role":"citizen_voter"}"#.utf8)
        try storeItem(legacy)

        XCTAssertEqual(
            vault.load(),
            TranStoredSession(refreshToken: "rt-legacy", userId: "voter-001", roleWire: "citizen_voter"))
        // The upgrade writes nothing, so no failed rewrite can lose the credential (REQ-DB-012).
        XCTAssertEqual(storedItem(), legacy)
        // The next rotation stores the current version.
        try vault.save(TranStoredSession(refreshToken: "rt-next", userId: "voter-001", roleWire: "citizen_voter"))
        let rewritten = try XCTUnwrap(storedItem())
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: rewritten) as? [String: Any])
        XCTAssertEqual(json["schema"] as? Int, Int(tranStoredSessionSchema()))
    }

    func testCorruptSessionBytesAreDeleted() throws {
        for bytes in [Data("not json".utf8), Data([0xFF, 0x00, 0x7B]), Data("[]".utf8), Data()] {
            try storeItem(bytes)
            XCTAssertNil(vault.load())
            XCTAssertNil(storedItem(), "unreadable must not linger (REQ-SEC-020)")
        }
    }

    // MARK: - Push, through the real store

    /// Push has no JSON on the device: each fixture key is one `UserDefaults` value of the JSON type.
    private static let pushKeys = [
        "schema": TranPushStore.schemaKey,
        "token": TranPushStore.tokenKey,
        "registered_at_unix_s": TranPushStore.registeredAtKey,
    ]

    func testEveryKeptPushRecordReadsThroughThePushStore() throws {
        for c in try cases("push") {
            let (defaults, suite) = freshDefaults()
            defer { defaults.removePersistentDomain(forName: suite) }
            for (field, value) in c.raw {
                defaults.set(value, forKey: try XCTUnwrap(Self.pushKeys[field], field))
            }
            let before = Self.pushKeys.values.map { defaults.object(forKey: $0) as? NSObject }

            let registration = TranPushStore(defaults: defaults).lastRegistration

            if let expected = c.expected {
                let read = try XCTUnwrap(registration, c.name)
                XCTAssertEqual(read.token, expected["token"] as? String, c.name)
                XCTAssertEqual(read.registeredAtUnixS, (expected["registeredAtUnixS"] as? NSNumber)?.int64Value, c.name)
            } else {
                XCTAssertNil(registration, c.name)
            }
            let after = Self.pushKeys.values.map { defaults.object(forKey: $0) as? NSObject }
            XCTAssertEqual(after, c.kept ? before : Self.pushKeys.values.map { _ in nil }, "\(c.name): stored afterwards")
        }
    }

    /// What the release before versioning wrote: a token and a time, no schema key.
    func testThePreviousReleaseRegistrationIsKept() throws {
        let (defaults, suite) = freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("tok-legacy", forKey: TranPushStore.tokenKey)
        defaults.set(NSNumber(value: Int64(1_700_000_000)), forKey: TranPushStore.registeredAtKey)

        let read = TranPushStore(defaults: defaults).lastRegistration

        XCTAssertEqual(read?.token, "tok-legacy")
        XCTAssertEqual(read?.registeredAtUnixS, 1_700_000_000)
        XCTAssertNil(defaults.object(forKey: TranPushStore.schemaKey), "reading writes nothing")
    }

    func testNoPushRecordIsNotARegistration() {
        let (defaults, suite) = freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertNil(TranPushStore(defaults: defaults).lastRegistration)
    }

    // MARK: - Config, through the real store

    private let configKey = "tran.remote_config"
    private let etagKey = "tran.remote_config_etag"

    func testEveryKeptConfigRecordReadsThroughTheConfigStore() throws {
        for c in try cases("config") {
            let (defaults, suite) = freshDefaults()
            defer { defaults.removePersistentDomain(forName: suite) }
            let bytes = try JSONSerialization.data(withJSONObject: c.raw)
            defaults.set(bytes, forKey: configKey)
            defaults.set("\"etag-1\"", forKey: etagKey)

            let store = RemoteConfigStore(userDefaults: defaults)

            if let expected = c.expected {
                let flags = try XCTUnwrap(expected["flags"] as? [String: Bool])
                XCTAssertEqual(store.isNotifyMe, flags["notify_me"], c.name)
                XCTAssertEqual(store.version, expected["configVersion"] as? Int, c.name)
                let client = expected["client"] as? [String: String]
                XCTAssertEqual(store.thresholds.minimum, client?["minimumVersion"], c.name)
                XCTAssertEqual(store.thresholds.recommended, client?["recommendedVersion"], c.name)
                XCTAssertEqual(defaults.string(forKey: etagKey), "\"etag-1\"", "\(c.name): a used cache keeps its ETag")
            } else {
                XCTAssertEqual(store.isNotifyMe, Flags.notifyMeDefault, "\(c.name): compiled default")
                XCTAssertEqual(store.version, 1, c.name)
                XCTAssertNil(defaults.string(forKey: etagKey), "\(c.name): no ETag for a cache not in use")
            }
            XCTAssertEqual(defaults.data(forKey: configKey), c.kept ? bytes : nil, "\(c.name): stored afterwards")
        }
    }

    func testCorruptConfigBytesAreDeleted() {
        let (defaults, suite) = freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(Data("not json".utf8), forKey: configKey)
        defaults.set("\"etag-1\"", forKey: etagKey)

        let store = RemoteConfigStore(userDefaults: defaults)

        XCTAssertEqual(store.isNotifyMe, Flags.notifyMeDefault)
        XCTAssertNil(defaults.object(forKey: configKey))
        XCTAssertNil(defaults.object(forKey: etagKey))
    }
}
