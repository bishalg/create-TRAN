// Verifies: REQ-NAV-006 REQ-RULE-009
import XCTest

/// `fixtures/navigation.json` and the country table through the UniFFI surface the app uses.
final class NavigationParityTests: XCTestCase {
    private func fixture(_ name: String) throws -> [String: Any] {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("fixtures/\(name)"))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    private func session(_ raw: String) -> AuthSession {
        switch raw {
        case "none", "unauthenticated": return .unauthenticated
        case "citizen_voter": return .authenticated(role: .citizenVoter)
        case "election_auditor": return .authenticated(role: .electionAuditor)
        default: fatalError("unknown fixture session \(raw)")
        }
    }

    private func name(_ destination: TranAppDestination) -> String {
        switch destination {
        case .splash: return "splash"
        case .authWelcome: return "auth_welcome"
        case .voterDashboard: return "voter_dashboard"
        case .auditorDashboard: return "auditor_dashboard"
        }
    }

    func testDestinationsMatchGoldenFixture() throws {
        let rows = try fixture("navigation.json")["destinations"] as! [[String: String]]
        for row in rows {
            XCTAssertEqual(name(session(row["session"]!).destination), row["destination"], row["name"]!)
        }
    }

    func testSupportedCountriesMatchGoldenFixture() throws {
        let rows = try fixture("vote-eligibility.json")["countries"] as! [[String: Any]]
        let expected = rows.map { "\($0["countryCode"] as! String)=\($0["minimumAge"] as! Int)" }
        let actual = supportedCountriesOffline().map { "\($0.countryCode)=\($0.minimumAge)" }
        XCTAssertEqual(actual, expected)
    }
}
