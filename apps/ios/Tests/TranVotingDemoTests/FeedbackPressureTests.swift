// Verifies: REQ-ERR-010 REQ-ERR-012 REQ-ERR-013 REQ-ERR-014
import XCTest

/// Toast pressure, failure dialogs, the recovery schedule and the reporter: the shared rows of
/// `fixtures/feedback.json` through UniFFI, plus the iOS mechanics over them (ADR-0036).
@MainActor
final class FeedbackPressureTests: XCTestCase {
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

    private func tone(_ name: String) -> TranToastTone {
        switch name {
        case "success": return .success
        case "info": return .info
        case "warning": return .warning
        default: return .error
        }
    }

    private func key(_ pair: [String]) -> TranToastKey {
        TranToastKey(messageKey: pair[0], tone: tone(pair[1]))
    }

    override func tearDown() async throws {
        TranReporting.sink = nil
    }

    func testToastAdmissionMatchesEveryFixtureCase() throws {
        let policy = try fixture()["toastPolicy"] as! [String: Any]
        XCTAssertEqual(Int(toastPolicy().maxVisible), policy["maxVisible"] as? Int)
        for row in try fixture()["toastQueue"] as! [[String: Any]] {
            let name = row["name"] as! String
            let visible = (row["visible"] as! [[String]]).map(key)
            let expected = row["expected"] as! [String: Any]
            let admission = admitToast(visible: visible, incoming: key(row["incoming"] as! [String]))
            if let index = expected["refresh"] as? Int {
                XCTAssertEqual(admission, .refresh(index: UInt32(index)), name)
            } else {
                XCTAssertEqual(
                    admission, .append(evictOldest: UInt32(expected["evictOldest"] as! Int)), name)
            }
        }
    }

    func testRecoveryScheduleAndReportedLevelsMatchTheFixture() throws {
        let policy = try fixture()["recoveryPolicy"] as! [String: Any]
        XCTAssertEqual(Int(recoveryPolicy().firstProbeMs), policy["firstProbeMs"] as? Int)
        XCTAssertEqual(Int(recoveryPolicy().maxProbeMs), policy["maxProbeMs"] as? Int)
        for row in try fixture()["recoveryProbes"] as! [[String: Any]] {
            XCTAssertEqual(
                Int(recoveryProbeDelayMs(probe: UInt32(row["probe"] as! Int))),
                row["expectedMs"] as? Int)
        }
        let levels: [(TranLogLevel, String)] = [
            (.debug, "debug"), (.info, "info"), (.warn, "warn"), (.error, "error"),
        ]
        XCTAssertEqual(
            levels.filter { isReportedLogLevel(level: $0.0) }.map(\.1),
            try fixture()["reportedLogLevels"] as? [String])
    }

    func testARepeatedFailureRefreshesOneToast() {
        let feedback = TranFeedback()
        feedback.report(TranRequestFailure(code: .serverInternal, requestId: "req-1"))
        feedback.report(TranRequestFailure(code: .serverInternal, requestId: "req-2"))
        XCTAssertEqual(feedback.toasts.count, 1)
        XCTAssertEqual(feedback.toasts[0].generation, 1)
        XCTAssertEqual(feedback.toasts[0].reference, L10n.Errors.reference("req-2"))
    }

    func testAtMostThreeToastsAndTheOldestGoesFirst() {
        let feedback = TranFeedback()
        feedback.report(TranRequestFailure(code: .serverInternal))
        feedback.report(TranRequestFailure(code: .serverRateLimited))
        feedback.report(TranRequestFailure(code: .authForbidden))
        feedback.acknowledge(.serverCheckSucceeded)
        XCTAssertEqual(feedback.toasts.count, 3)
        XCTAssertFalse(feedback.toasts.contains { $0.tone == .error && $0.message == L10n.Errors.serverInternal })
        XCTAssertEqual(feedback.toast?.message, L10n.Eligibility.serverCheckDone)
        feedback.dismissToast(feedback.toasts[0].id)
        XCTAssertEqual(feedback.toasts.count, 2)
    }

    func testAnExpiredSessionAsksAndOnlyConfirmSignsOut() {
        let feedback = TranFeedback()
        var signedOut = 0
        feedback.onErrorConfirmed(.authSessionExpired) { signedOut += 1 }

        XCTAssertEqual(
            feedback.report(TranRequestFailure(code: .authSessionExpired, status: 401)),
            .dialog(destructive: false))
        let pending = feedback.confirmation
        XCTAssertEqual(pending?.title, L10n.Errors.sessionExpired)
        XCTAssertEqual(pending?.body, L10n.Errors.sessionExpiredBody)
        XCTAssertEqual(pending?.confirmLabel, L10n.Auth.signInAgain)
        XCTAssertEqual(pending?.cancelLabel, L10n.Common.notNow)
        XCTAssertEqual(pending?.destructive, false)
        XCTAssertEqual(signedOut, 0, "nothing happens until the user confirms")
        pending?.onConfirm()
        XCTAssertEqual(signedOut, 1)
        XCTAssertNil(feedback.toast, "a dialog is not also a toast")
    }

    func testEveryDialogFailureHasCopy() {
        for spec in errorCatalogue() {
            if case .dialog = spec.presentation {
                XCTAssertNotNil(TranFeedback.errorDialogCopy(spec.code), "\(spec.wireCode) needs copy")
            }
        }
    }

    func testOnlyErrorLevelFailuresReachTheReporter() {
        let events = Recorder<TranReporting.Event>()
        TranReporting.sink = { event, _ in events.add(event) }
        let feedback = TranFeedback()
        feedback.log(TranRequestFailure(code: .networkOffline))
        feedback.log(TranRequestFailure(code: .authForbidden, status: 403))
        feedback.log(TranRequestFailure(code: .serverInternal, status: 500, requestId: "req-9"))
        XCTAssertEqual(
            events.items,
            [TranReporting.Event(code: "server.internal", status: 500, requestId: "req-9")])
    }

    func testOnlyClientSideCodesCarryADetail() {
        let details = Recorder<String?>()
        TranReporting.sink = { _, detail in details.add(detail) }
        TranReporting.report(TranRequestFailure(code: .clientUnexpected), detail: "NSRangeException")
        TranReporting.report(TranRequestFailure(code: .serverInternal), detail: "payload")
        XCTAssertEqual(details.items, ["NSRangeException", nil])
    }
}

/// Collects values from `@Sendable` callbacks in tests.
final class Recorder<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Value] = []

    func add(_ value: Value) { lock.withLock { values.append(value) } }

    var items: [Value] { lock.withLock { values } }
}
