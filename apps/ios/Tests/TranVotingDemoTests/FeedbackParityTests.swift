// Verifies: REQ-ERR-001 REQ-ERR-006 REQ-ERR-007 REQ-ERR-008 REQ-ERR-009 REQ-ROB-007
import XCTest

/// `fixtures/feedback.json` through the UniFFI surface, plus the iOS feedback center that applies it.
@MainActor
final class FeedbackParityTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("fixtures/feedback.json"))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    private func json(_ presentation: TranPresentation) -> [String: AnyHashable] {
        switch presentation {
        case .silent: return ["kind": "silent"]
        case .inline: return ["kind": "inline"]
        case .banner: return ["kind": "banner"]
        case let .dialog(destructive): return ["kind": "dialog", "destructive": destructive]
        case let .toast(tone, duration):
            return ["kind": "toast", "tone": "\(tone)", "duration": "\(duration)"]
        }
    }

    func testCatalogueMatchesTheGoldenFixtureAndEveryMessageIsLocalized() throws {
        let rows = try fixture()["errors"] as! [[String: Any]]
        let catalogue = errorCatalogue()
        XCTAssertEqual(catalogue.count, rows.count)
        for (spec, row) in zip(catalogue, rows) {
            let code = row["code"] as! String
            XCTAssertEqual(spec.wireCode, code)
            XCTAssertEqual(spec.httpStatus.map(Int.init), row["httpStatus"] as? Int, code)
            XCTAssertEqual(spec.retryable, row["retryable"] as? Bool, code)
            XCTAssertEqual("\(spec.logLevel)", row["logLevel"] as? String, code)
            let expected = (row["presentation"] as! [String: Any]).mapValues { $0 as! AnyHashable }
            XCTAssertEqual(json(spec.presentation), expected, code)
            XCTAssertEqual(spec.messageKey, row["messageKey"] as? String, code)
            XCTAssertNotNil(L10n.feedback(spec.messageKey), "\(spec.messageKey) has no iOS string")
        }
    }

    func testLogLineCarriesTheFixedFieldsOfTheLogEvent() throws {
        let event = try fixture()["logEvent"] as! [String: Any]
        let full = TranFeedback.logLine(
            TranRequestFailure(code: .serverInternal, status: 500, requestId: "req-9"))
        XCTAssertEqual(full, "request failed code=server.internal status=500 request_id=req-9")
        XCTAssertTrue(full.hasPrefix(event["message"] as! String))
        for field in event["fields"] as! [String] {
            XCTAssertTrue(full.contains(" \(field)="), field)
        }
        XCTAssertEqual(
            TranFeedback.logLine(TranRequestFailure(code: .networkOffline)),
            "request failed code=network.offline status=- request_id=-"
        )
    }

    func testToastDurationsMatchTheFixture() throws {
        let durations = try fixture()["toastDurationsMs"] as! [String: Int]
        for duration in [TranToastDuration.short, .medium, .long] {
            XCTAssertEqual(Int(toastDurationMs(duration: duration)), durations["\(duration)"])
        }
    }

    func testSuccessIsAShortSuccessToast() {
        let feedback = TranFeedback()
        feedback.acknowledge(.serverCheckSucceeded)
        XCTAssertEqual(feedback.toast?.tone, .success)
        XCTAssertEqual(feedback.toast?.message, L10n.Eligibility.serverCheckDone)
        XCTAssertEqual(feedback.toast?.durationMs, 3000)
        XCTAssertNil(feedback.toast?.reference)
        feedback.dismissToast()
        XCTAssertNil(feedback.toast)
    }

    func testServerFailureIsALongToastWithAReference() {
        let feedback = TranFeedback()
        let presentation = feedback.report(TranRequestFailure(code: .serverInternal, requestId: "req-9"))
        XCTAssertEqual(presentation, .toast(tone: .error, duration: .long))
        XCTAssertEqual(feedback.toast?.durationMs, 10_000)
        XCTAssertEqual(feedback.toast?.reference, L10n.Errors.reference("req-9"))
    }

    func testScreenOwnedPresentationsDoNotToast() {
        let feedback = TranFeedback()
        XCTAssertEqual(feedback.report(TranRequestFailure(code: .networkOffline)), .banner)
        XCTAssertEqual(feedback.report(TranRequestFailure(code: .validationInvalidDate)), .inline)
        XCTAssertNil(feedback.toast)
    }

    func testSignOutAsksFirstAndOnlyConfirmPerforms() {
        let feedback = TranFeedback()
        var signedOut = false
        feedback.confirm(.signOut) { signedOut = true }

        let pending = try? XCTUnwrap(feedback.confirmation)
        XCTAssertEqual(pending?.title, L10n.Auth.signOutConfirmTitle)
        XCTAssertEqual(pending?.body, L10n.Auth.signOutConfirmBody)
        XCTAssertEqual(pending?.confirmLabel, L10n.Common.signOut)
        XCTAssertEqual(pending?.destructive, true)
        XCTAssertFalse(signedOut, "nothing happens until the user confirms")

        pending?.onConfirm()
        XCTAssertTrue(signedOut)
    }

    func testActionsWithoutADialogRunImmediately() {
        let feedback = TranFeedback()
        var ran = false
        feedback.confirm(.serverCheckSucceeded) { ran = true }
        XCTAssertTrue(ran)
        XCTAssertNil(feedback.confirmation)
    }

    func testEveryDialogActionHasCopy() {
        for action in [TranUserAction.signOut, .serverCheckSucceeded] {
            if case .dialog = actionSpec(action: action).presentation {
                XCTAssertNotNil(TranFeedback.dialogCopy(action), "\(action) needs dialog copy")
            }
        }
    }
}
