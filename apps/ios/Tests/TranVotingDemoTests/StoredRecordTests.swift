// Verifies: REQ-DB-011 REQ-DB-012
import XCTest

final class StoredRecordTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("fixtures/stored-records.json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testCurrentSchemasMatchFixture() throws {
        let schemas = try XCTUnwrap(fixture()["currentSchemas"] as? [String: Int])
        XCTAssertEqual(Int(tranStoredSessionSchema()), schemas["session"])
        XCTAssertEqual(Int(tranStoredPushSchema()), schemas["push"])
        XCTAssertEqual(Int(tranStoredConfigSchema()), schemas["config"])
    }

    func testStoredRecordDecisionsMatchFixture() throws {
        let cases = try XCTUnwrap(fixture()["decisions"] as? [[String: Any]])
        for c in cases {
            let label = try XCTUnwrap(c["name"] as? String)
            let schema = try XCTUnwrap(c["schema"] as? Int)
            let current = try XCTUnwrap(c["current"] as? Int)
            let expectedAction = try XCTUnwrap(c["action"] as? String)

            let decision = tranStoredRecordDecision(schema: UInt32(schema), current: UInt32(current))
            let actionStr: String
            switch decision {
            case .use: actionStr = "use"
            case .upgrade: actionStr = "upgrade"
            case .discard: actionStr = "discard"
            }
            XCTAssertEqual(actionStr, expectedAction, label)
        }
    }

    func testSessionRecordsKeptVersionsKeepUserSignedIn() throws {
        let records = try XCTUnwrap(fixture()["records"] as? [String: Any])
        let sessionCases = try XCTUnwrap(records["session"] as? [[String: Any]])

        for c in sessionCases {
            let label = try XCTUnwrap(c["name"] as? String)
            let rawObj = try XCTUnwrap(c["raw"])
            let rawData = try JSONSerialization.data(withJSONObject: rawObj)
            let rawJson = String(decoding: rawData, as: UTF8.self)

            let result = tranReadStoredSession(rawJson: rawJson, currentSchema: tranStoredSessionSchema())

            if let expected = c["expected"] as? [String: Any] {
                let rec: TranStoredSessionRecord = try XCTUnwrap(result, "\(label): should parse and upgrade")
                XCTAssertEqual(Int(rec.schema), expected["schema"] as? Int, "\(label): schema")
                XCTAssertEqual(rec.userId, expected["userId"] as? String, "\(label): userId")
                XCTAssertEqual(rec.role, expected["role"] as? String, "\(label): role")
                XCTAssertEqual(rec.refreshToken, expected["refreshToken"] as? String, "\(label): refreshToken")
            } else {
                XCTAssertNil(result, "\(label): expected nil / discard")
            }
        }
    }

    func testPushRecordsKeptVersionsMatchFixture() throws {
        let records = try XCTUnwrap(fixture()["records"] as? [String: Any])
        let pushCases = try XCTUnwrap(records["push"] as? [[String: Any]])

        for c in pushCases {
            let label = try XCTUnwrap(c["name"] as? String)
            let rawObj = try XCTUnwrap(c["raw"])
            let rawData = try JSONSerialization.data(withJSONObject: rawObj)
            let rawJson = String(decoding: rawData, as: UTF8.self)

            let result = tranReadStoredPush(rawJson: rawJson, currentSchema: tranStoredPushSchema())

            if let expected = c["expected"] as? [String: Any] {
                let rec: TranStoredPushRecord = try XCTUnwrap(result, "\(label): should parse and upgrade")
                XCTAssertEqual(Int(rec.schema), expected["schema"] as? Int, "\(label): schema")
                XCTAssertEqual(rec.token, expected["token"] as? String, "\(label): token")
                XCTAssertEqual(rec.registeredAtUnixS, (expected["registeredAtUnixS"] as? NSNumber)?.int64Value, "\(label): at")
            } else {
                XCTAssertNil(result, "\(label): expected nil / discard")
            }
        }
    }

    func testTranPushStoreUpgradesAndDiscards() {
        let suiteName = "test-push-store-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = TranPushStore(defaults: defaults)

        // Write v1 record manually
        defaults.set(1, forKey: TranPushStore.schemaKey)
        defaults.set("tok-v1", forKey: TranPushStore.tokenKey)
        defaults.set(NSNumber(value: 1700000000), forKey: TranPushStore.registeredAtKey)

        // Reading upgrades schema to current
        let upgraded = store.lastRegistration
        XCTAssertNotNil(upgraded)
        XCTAssertEqual(upgraded?.token, "tok-v1")
        XCTAssertEqual(defaults.integer(forKey: TranPushStore.schemaKey), Int(tranStoredPushSchema()))

        // Write future schema (e.g. 99)
        defaults.set(99, forKey: TranPushStore.schemaKey)
        let discarded = store.lastRegistration
        XCTAssertNil(discarded)
        XCTAssertNil(defaults.object(forKey: TranPushStore.tokenKey))
    }

    func testRemoteConfigStoreUpgradesAndDiscards() {
        let suiteName = "test-config-store-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        // Write v1 record
        let v1Payload: [String: Any] = [
            "schema": 1,
            "flags": ["notify_me": true],
            "client": ["minimum_version": "1.0.0", "recommended_version": "1.2.0"],
            "config_version": 10
        ]
        let v1Data = try! JSONSerialization.data(withJSONObject: v1Payload)
        defaults.set(v1Data, forKey: "tran.remote_config")

        let store = RemoteConfigStore(userDefaults: defaults)
        XCTAssertTrue(store.isNotifyMe)
        XCTAssertEqual(store.version, 10)

        // Write future schema 99
        let vFuturePayload: [String: Any] = [
            "schema": 99,
            "flags": ["notify_me": true],
            "config_version": 99
        ]
        let vFutureData = try! JSONSerialization.data(withJSONObject: vFuturePayload)
        defaults.set(vFutureData, forKey: "tran.remote_config")

        let storeFuture = RemoteConfigStore(userDefaults: defaults)
        XCTAssertFalse(storeFuture.isNotifyMe) // falls back to defaults without crashing
        XCTAssertEqual(storeFuture.version, 1)
    }
}
