// Verifies: REQ-PSH-009
import XCTest

/// `fixtures/push.json` through the UniFFI surface the app calls: the device policy and every row
/// of the `push_sync` table, as Rust, TypeScript and Android read them.
final class PushParityTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("fixtures/push.json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func name(_ action: TranPushAction) -> String {
        switch action {
        case .register: return "register"
        case .unregister: return "unregister"
        case .nothing: return "nothing"
        }
    }

    func testThePolicyMatchesTheFixture() throws {
        let policy = try XCTUnwrap(fixture()["policy"] as? [String: Int])
        XCTAssertEqual(Int(devicePolicy().staleAfterDays), policy["staleAfterDays"])
        XCTAssertEqual(Int(devicePolicy().refreshAfterDays), policy["refreshAfterDays"])
    }

    func testEverySyncRowMatchesTheFixture() throws {
        let rows = try XCTUnwrap(fixture()["sync"] as? [[String: Any]])
        XCTAssertGreaterThan(rows.count, 60)
        for row in rows {
            let label = try XCTUnwrap(row["name"] as? String)
            let last = (row["lastRegistration"] as? [String: Any]).map { recorded in
                TranLastRegistration(
                    token: recorded["token"] as? String ?? "",
                    registeredAtUnixS: (recorded["registeredAtUnixS"] as? NSNumber)?.int64Value ?? 0)
            }
            let state = TranPushState(
                pushAvailable: try XCTUnwrap(row["pushAvailable"] as? Bool, label),
                permissionGranted: try XCTUnwrap(row["permissionGranted"] as? Bool, label),
                hasSession: try XCTUnwrap(row["hasSession"] as? Bool, label),
                currentToken: row["currentToken"] as? String,
                lastRegistration: last,
                nowUnixS: try XCTUnwrap(row["nowUnixS"] as? NSNumber, label).int64Value
            )
            XCTAssertEqual(name(pushSync(state: state)), row["action"] as? String, label)
        }
        // All three answers appear in the table.
        XCTAssertEqual(Set(rows.compactMap { $0["action"] as? String }), ["register", "unregister", "nothing"])
    }
}
