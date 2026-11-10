// Verifies: REQ-PRV-001 REQ-PRV-002 REQ-PRV-008
import XCTest

/// `fixtures/permissions.json` through the UniFFI surface the app calls: the permission catalogue,
/// every `(status, primed)` step and the personal-question catalogue, as Rust, TypeScript and
/// Android read them.
final class PermissionParityTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("fixtures/permissions.json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func name(_ step: TranPermissionStep) -> String {
        switch step {
        case .showPriming: return "show_priming"
        case .requestSystem: return "request_system"
        case .useFeature: return "use_feature"
        case .offerSettings: return "offer_settings"
        }
    }

    private func name(_ fallback: TranPermissionFallback) -> String {
        switch fallback {
        case .keepManualEntry: return "keep_manual_entry"
        case .noReminder: return "no_reminder"
        }
    }

    private func name(_ kind: TranAnswerKind) -> String {
        switch kind {
        case .choice: return "choice"
        case .selfDescribed: return "self_described"
        case .preferNotToSay: return "prefer_not_to_say"
        }
    }

    func testTheCatalogueMatchesTheFixture() throws {
        let rows = try XCTUnwrap(fixture()["permissions"] as? [[String: Any]])
        let catalogue = permissionCatalogue()
        XCTAssertEqual(catalogue.map(\.id.wire), rows.map { $0["id"] as? String })
        for (entry, row) in zip(catalogue, rows) {
            let id = entry.id.wire
            XCTAssertEqual(entry.feature, row["feature"] as? String, id)
            XCTAssertEqual(entry.control, row["control"] as? String, id)
            XCTAssertEqual(entry.primingTitleKey, row["primingTitle"] as? String, id)
            XCTAssertEqual(entry.primingBodyKey, row["primingBody"] as? String, id)
            XCTAssertEqual(entry.purposeKey, row["purpose"] as? String, id)
            XCTAssertEqual(entry.settingsNoteKey, row["settingsNote"] as? String, id)
            XCTAssertEqual(name(entry.fallback), row["fallback"] as? String, id)
            XCTAssertEqual(entry.androidPermissions, row["androidPermissions"] as? [String], id)
            XCTAssertEqual(entry.iosUsageDescriptions, row["iosUsageDescriptions"] as? [String], id)
            XCTAssertEqual(permissionEntry(id: entry.id), entry, id)
        }
    }

    func testEveryStepMatchesTheFixture() throws {
        let rows = try XCTUnwrap(fixture()["steps"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 12)
        for row in rows {
            let label = try XCTUnwrap(row["name"] as? String)
            let status = try XCTUnwrap(TranPermissionStatus(wire: XCTUnwrap(row["status"] as? String)), label)
            let primed = try XCTUnwrap(row["primed"] as? Bool, label)
            XCTAssertEqual(name(permissionStep(status: status, primed: primed)), row["step"] as? String, label)
        }
        // Every status the app can report appears in the table, primed and not.
        let covered = Set(rows.compactMap { row in (row["status"] as? String).map { "\($0)/\(row["primed"]!)" } })
        XCTAssertEqual(covered.count, TranPermissionStatus.all.count * 2)
    }

    func testPersonalQuestionsMatchTheFixture() throws {
        let rows = try XCTUnwrap(fixture()["personalQuestions"] as? [[String: Any]])
        let questions = personalQuestions()
        XCTAssertEqual(questions.map(\.id), rows.map { $0["id"] as? String })
        for (question, row) in zip(questions, rows) {
            XCTAssertEqual(question.feature, row["feature"] as? String, question.id)
            XCTAssertEqual(question.labelKey, row["label"] as? String, question.id)
            XCTAssertEqual(question.requiredBy, row["required"] as? String, question.id)
            let answers = try XCTUnwrap(row["answers"] as? [[String: String]], question.id)
            XCTAssertEqual(question.answers.map(\.id), answers.map { $0["id"] })
            XCTAssertEqual(question.answers.map { name($0.kind) }, answers.map { $0["kind"] })
            XCTAssertEqual(question.answers.map(\.labelKey), answers.map { $0["label"] })
        }
    }

    func testWireNamesRoundTrip() {
        for status in TranPermissionStatus.all {
            XCTAssertEqual(TranPermissionStatus(wire: status.wire), status)
        }
        for id in TranPermissionId.all {
            XCTAssertEqual(TranPermissionId(wire: id.wire), id)
        }
        XCTAssertNil(TranPermissionStatus(wire: "maybe"))
        XCTAssertNil(TranPermissionId(wire: "camera"))
    }
}
