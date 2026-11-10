// Verifies: REQ-ACC-005 REQ-ACC-006 REQ-ROB-007
import XCTest

/// The coordinator's deletion flow (`TranAccountDeletion`, wired by `NavigationCoordinatorView`) on
/// a scripted transport. No screen-contract scenario stages a deletion the server confirms (the
/// native suites run without an API), so this proves the confirmed path end to end: dialog,
/// `DELETE /api/account`, the vault cleared, Auth Welcome and the success toast.
@MainActor
final class AccountDeletionTests: XCTestCase {
    private var vault: InMemorySessionVault!
    private var feedback: TranFeedback!
    /// The coordinator's state: where the app is.
    private var session: AuthSession = .authenticated(role: .citizenVoter)
    private var failures: [TranRequestFailure] = []
    private var deletion: TranAccountDeletion!
    /// Every `request failed` event, from the client and from the feedback center alike.
    private var events: FailureLog!

    override func setUp() {
        super.setUp()
        vault = InMemorySessionVault(SessionWire.stored(refresh: "refresh-0"))
        events = FailureLog()
        feedback = TranFeedback()
        feedback.writer = events.record
        deletion = TranAccountDeletion()
        session = .authenticated(role: .citizenVoter)
        failures = []
    }

    private func client() -> TranSessionClient {
        TranSessionClient(
            vault: vault, baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: SessionStubProtocol.session(), log: events.record)
    }

    /// Opens the dialog as the "Delete account" control does, confirms it and waits for the answer.
    private func confirmDeletion(answer reply: SessionStubProtocol.Reply) async throws {
        SessionStubProtocol.reset { request in
            request.path == "/api/auth/refresh"
                ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
                : reply
        }
        let settled = expectation(description: "the server answered")
        deletion.confirm(
            client: client(),
            feedback: feedback,
            onDeleted: {
                self.session = .unauthenticated
                settled.fulfill()
            },
            onFailed: {
                self.failures.append($0)
                settled.fulfill()
            }
        )
        XCTAssertTrue(SessionStubProtocol.requests.isEmpty, "nothing is sent before the user confirms")
        let dialog = try XCTUnwrap(feedback.confirmation)
        XCTAssertEqual(dialog.title, L10n.Auth.deleteAccountConfirmTitle)
        XCTAssertEqual(dialog.body, L10n.Auth.deleteAccountConfirmBody)
        XCTAssertEqual(dialog.confirmLabel, L10n.Common.deleteAccount)
        XCTAssertEqual(dialog.cancelLabel, L10n.Common.cancel)
        XCTAssertTrue(dialog.destructive)
        dialog.onConfirm()
        await fulfillment(of: [settled], timeout: 5)
    }

    func testConfirmingDeletesTheAccountAndReturnsToRoleSelection() async throws {
        try await confirmDeletion(answer: .status(204, body: ""))

        XCTAssertEqual(SessionStubProtocol.requests(to: "/api/account").map(\.method), ["DELETE"])
        XCTAssertEqual(session.destination, .authWelcome)
        XCTAssertNil(vault.load())
        XCTAssertEqual(feedback.toast?.messageKey, "auth.accountDeleted")
        XCTAssertEqual(feedback.toast?.message, L10n.Auth.accountDeleted)
        XCTAssertEqual(feedback.toast?.tone, .success)
        XCTAssertTrue(failures.isEmpty)
    }

    func testAnUnreachableServerKeepsTheAccountAndShowsTheBanner() async throws {
        try await confirmDeletion(answer: .failure(.cannotConnectToHost))

        XCTAssertEqual(session.destination, .voterDashboard, "still signed in")
        XCTAssertEqual(vault.load()?.refreshToken, "refresh-1", "the vault keeps the session")
        XCTAssertEqual(failures.map(\.code), [.networkOffline])
        XCTAssertEqual(events.entries.map(\.code), [.networkOffline], "one event for the one failure")
        XCTAssertEqual(failures.first?.spec.presentation, .banner, "the screen shows its offline banner")
        XCTAssertNil(feedback.toast, "no success toast")
    }

    func testAServerErrorKeepsTheAccountAndSaysSo() async throws {
        try await confirmDeletion(answer: .status(500, body: "{}"))

        XCTAssertEqual(session.destination, .voterDashboard)
        XCTAssertNotNil(vault.load())
        XCTAssertEqual(feedback.toast?.messageKey, errorSpec(code: .serverInternal).messageKey)
        XCTAssertEqual(feedback.toast?.tone, .error)
        XCTAssertEqual(events.entries.map(\.code), [.serverInternal], "logged once, so reported once")
    }

    func testADeadSessionAsksToSignInAgain() async throws {
        try await confirmDeletion(answer: .status(401, body: SessionWire.expired))

        XCTAssertNil(vault.load(), "the recovery table ended the session")
        XCTAssertEqual(failures, [TranSessionClient.expired])
        XCTAssertEqual(events.entries.map(\.status), [401], "the DELETE's 401, once; the dialog adds none")
        XCTAssertEqual(
            feedback.confirmation?.title, TranFeedback.message(errorSpec(code: .authSessionExpired).messageKey))
    }

    func testCancelSendsNothing() {
        SessionStubProtocol.reset { _ in .status(204, body: "") }
        deletion.confirm(
            client: client(), feedback: feedback,
            onDeleted: { XCTFail("deleted without confirming") },
            onFailed: { _ in XCTFail("sent without confirming") })

        // Cancel is the alert's dismissal: the host clears the pending confirmation.
        feedback.confirmation = nil

        XCTAssertTrue(SessionStubProtocol.requests.isEmpty)
        XCTAssertNotNil(vault.load())
    }

    // MARK: - One deletion at a time (REQ-ACC-006)

    func testTheControlIsDisabledUntilTheServerAnswersAndUsableAgainAfterAFailure() async throws {
        SessionStubProtocol.reset { request in
            request.path == "/api/auth/refresh"
                ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
                : .status(503, body: "{}", delay: 0.3)
        }
        let settled = expectation(description: "the server answered")
        let client = client()
        deletion.confirm(
            client: client, feedback: feedback,
            onDeleted: { XCTFail("a 503 deletes nothing") },
            onFailed: { _ in settled.fulfill() })
        XCTAssertFalse(deletion.inFlight, "asking is not deleting")
        let dialog = try XCTUnwrap(feedback.confirmation)
        dialog.onConfirm()
        XCTAssertTrue(deletion.inFlight, "disabled from the confirmation on")

        // A second activation while pending opens nothing and sends nothing.
        feedback.confirmation = nil
        deletion.confirm(
            client: client, feedback: feedback,
            onDeleted: { XCTFail("second deletion") }, onFailed: { _ in XCTFail("second deletion") })
        XCTAssertNil(feedback.confirmation)
        dialog.onConfirm()

        await fulfillment(of: [settled], timeout: 5)
        XCTAssertFalse(deletion.inFlight, "usable again after a failure")
        XCTAssertEqual(SessionStubProtocol.requests(to: "/api/account").count, 1)
        deletion.confirm(client: client, feedback: feedback, onDeleted: {}, onFailed: { _ in })
        XCTAssertNotNil(feedback.confirmation, "the control asks again")
    }
}
