// Verifies: REQ-SEC-005 REQ-SEC-015
import XCTest

/// `fixtures/session.json` through the UniFFI surface the session client uses: the policy numbers
/// and the recovery table come from Rust, never from Swift.
final class SessionParityTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("fixtures/session.json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func event(_ row: [String: Any]) -> TranSessionEvent {
        switch row["event"] as? String {
        case "unauthorized":
            return .unauthorized(
                hasRefreshCredential: row["hasRefreshCredential"] as! Bool,
                alreadyRetried: row["alreadyRetried"] as! Bool)
        case "refresh_rejected": return .refreshRejected
        case "refresh_failed": return .refreshFailed
        default: fatalError("unknown fixture event \(String(describing: row["event"]))")
        }
    }

    private func name(_ action: TranSessionAction) -> String {
        switch action {
        case .refresh: return "refresh"
        case .signOut: return "sign_out"
        case .keep: return "keep"
        }
    }

    private func name(_ event: TranSessionEvent?) -> String? {
        switch event {
        case nil: return nil
        case .unauthorized: return "unauthorized"
        case .refreshRejected: return "refresh_rejected"
        case .refreshFailed: return "refresh_failed"
        }
    }

    func testPolicyMatchesGoldenFixture() throws {
        let policy = try XCTUnwrap(try fixture()["policy"] as? [String: Int])
        let actual = sessionPolicy()
        XCTAssertEqual(actual.accessTtlSeconds, UInt64(try XCTUnwrap(policy["accessTtlSeconds"])))
        XCTAssertEqual(actual.refreshTtlSeconds, UInt64(try XCTUnwrap(policy["refreshTtlSeconds"])))
        XCTAssertEqual(actual.tokenBytes, UInt32(try XCTUnwrap(policy["tokenBytes"])))
    }

    func testRecoveryMatchesGoldenFixture() throws {
        let rows = try XCTUnwrap(try fixture()["recovery"] as? [[String: Any]])
        XCTAssertFalse(rows.isEmpty)
        for row in rows {
            XCTAssertEqual(name(sessionRecovery(event: event(row))), row["action"] as? String, row["name"] as! String)
        }
    }

    func testRefreshResponsesMatchGoldenFixture() throws {
        let rows = try XCTUnwrap(try fixture()["refreshResponses"] as? [[String: Any]])
        XCTAssertFalse(rows.isEmpty)
        for row in rows {
            let status = (row["status"] as? Int).map { UInt16($0) }
            XCTAssertEqual(name(sessionRefreshEvent(status: status)), row["event"] as? String, row["name"] as! String)
        }
    }
}
