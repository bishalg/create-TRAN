// Verifies: REQ-SEC-019 REQ-SEC-021 REQ-ROB-007
import XCTest

/// Launch: the Splash routes from the vault with no network, then the session is checked in the
/// background and only a dead credential signs the user out (REQ-SEC-021, ADR-0039 decision 7).
@MainActor
final class SessionRestoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "SessionRestoreTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        SessionStubProtocol.reset { _ in .failure(.unsupportedURL) }
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    private func client(_ vault: SessionVault) -> TranSessionClient {
        TranSessionClient(
            vault: vault, baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: SessionStubProtocol.session(), log: { _ in })
    }

    // MARK: - Splash, no network

    func testTheSplashRoutesFromTheVaultWithoutTheNetwork() throws {
        defaults.set(true, forKey: TranSessionLaunch.launchedKey)
        for (role, destination) in [
            ("citizen_voter", TranAppDestination.voterDashboard),
            ("election_auditor", .auditorDashboard),
        ] {
            let vault = InMemorySessionVault(SessionWire.stored(role: role))

            let restored = TranSessionLaunch.restore(vault: vault, defaults: defaults)

            XCTAssertEqual(restored.session.destination, destination, role)
            XCTAssertEqual(restored.stored, SessionWire.stored(role: role))
        }
        XCTAssertTrue(SessionStubProtocol.requests.isEmpty, "routing never waits for the API")
    }

    func testAnEmptyVaultLeadsToAuthWelcome() {
        defaults.set(true, forKey: TranSessionLaunch.launchedKey)

        let restored = TranSessionLaunch.restore(vault: InMemorySessionVault(), defaults: defaults)

        XCTAssertEqual(restored.session, .unauthenticated)
        XCTAssertEqual(restored.session.destination, .authWelcome)
        XCTAssertNil(restored.stored)
    }

    func testARecordWithAnUnknownRoleIsDeleted() {
        defaults.set(true, forKey: TranSessionLaunch.launchedKey)
        let vault = InMemorySessionVault(SessionWire.stored(role: "superuser"))

        let restored = TranSessionLaunch.restore(vault: vault, defaults: defaults)

        XCTAssertEqual(restored.session, .unauthenticated)
        XCTAssertNil(vault.load())
    }

    /// A Keychain item survives an uninstall; the first launch of a new install deletes it, and only
    /// a flag (no credential) is written to `UserDefaults` (REQ-SEC-019).
    func testTheFirstLaunchAfterAnInstallWipesALeftoverSession() {
        let vault = InMemorySessionVault(SessionWire.stored())

        let first = TranSessionLaunch.restore(vault: vault, defaults: defaults)

        XCTAssertEqual(first.session, .unauthenticated)
        XCTAssertNil(vault.load())
        XCTAssertEqual(
            defaults.persistentDomain(forName: suiteName)?.keys.sorted(), [TranSessionLaunch.launchedKey])

        try? vault.save(SessionWire.stored())
        let second = TranSessionLaunch.restore(vault: vault, defaults: defaults)
        XCTAssertEqual(second.session, .authenticated(role: .citizenVoter), "later launches keep it")
    }

    // MARK: - Background validation

    func testAValidSessionStaysAndShowsNothing() async throws {
        let vault = InMemorySessionVault(SessionWire.stored(refresh: "refresh-0"))
        SessionStubProtocol.reset { request in
            request.path == "/api/auth/refresh"
                ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
                : .status(200, body: #"{"user_id":"voter-001","role":"citizen_voter"}"#)
        }
        let feedback = TranFeedback()

        let outcome = await TranSessionRestore.validate(client(vault), feedback: feedback)

        XCTAssertEqual(outcome, .valid)
        XCTAssertEqual(SessionStubProtocol.requests.map(\.path), ["/api/auth/refresh", "/api/auth/session"])
        XCTAssertEqual(SessionStubProtocol.requests.last?.authorization, "Bearer access-1")
        XCTAssertEqual(vault.load()?.refreshToken, "refresh-1")
        XCTAssertNil(feedback.confirmation)
    }

    func testAnUnreachableApiNeverSignsTheUserOut() async {
        for reply in [
            SessionStubProtocol.Reply.failure(.cannotConnectToHost),
            .failure(.timedOut),
            .status(502, body: "{}"),
        ] {
            let vault = InMemorySessionVault(SessionWire.stored())
            SessionStubProtocol.reset { _ in reply }
            let feedback = TranFeedback()

            let outcome = await TranSessionRestore.validate(client(vault), feedback: feedback)

            XCTAssertEqual(outcome, .kept, "\(reply)")
            XCTAssertEqual(vault.load(), SessionWire.stored(), "\(reply)")
            XCTAssertNil(feedback.confirmation, "\(reply)")
            XCTAssertTrue(feedback.toasts.isEmpty, "\(reply)")
        }
    }

    func testADeadCredentialClearsTheVaultAndAsksToSignInAgain() async {
        let vault = InMemorySessionVault(SessionWire.stored())
        SessionStubProtocol.reset { _ in .status(401, body: SessionWire.expired) }
        let feedback = TranFeedback()
        var signedInAgain = false
        feedback.onErrorConfirmed(.authSessionExpired) { signedInAgain = true }

        let outcome = await TranSessionRestore.validate(client(vault), feedback: feedback)

        XCTAssertEqual(outcome, .signedOut)
        XCTAssertNil(vault.load())
        let dialog = try? XCTUnwrap(feedback.confirmation)
        XCTAssertEqual(dialog?.title, TranFeedback.message(errorSpec(code: .authSessionExpired).messageKey))
        dialog?.onConfirm()
        XCTAssertTrue(signedInAgain, "the dialog's confirm runs the app's sign-in-again handler")
    }

    /// The client logs the `401` it received; the dialog it leads to adds no second event.
    func testADeadCredentialIsLoggedOnce() async {
        let events = FailureLog()
        let vault = InMemorySessionVault(SessionWire.stored())
        SessionStubProtocol.reset { _ in .status(401, body: SessionWire.expired) }
        let feedback = TranFeedback()
        feedback.writer = events.record
        let client = TranSessionClient(
            vault: vault, baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: SessionStubProtocol.session(), log: events.record)

        await TranSessionRestore.validate(client, feedback: feedback)

        XCTAssertEqual(SessionStubProtocol.requests.map(\.path), ["/api/auth/refresh"])
        XCTAssertEqual(events.entries.map(\.code), [.authSessionExpired], "one request failed, one event")
        XCTAssertNotNil(feedback.confirmation, "and the dialog still asks")
    }
}
