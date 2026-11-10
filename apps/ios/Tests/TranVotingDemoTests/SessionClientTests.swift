// Verifies: REQ-SEC-014 REQ-SEC-015 REQ-SEC-016 REQ-SEC-017 REQ-SEC-022 REQ-ACC-006 REQ-ROB-007
import XCTest

/// The session client on a scripted transport (ADR-0023): sign-in on the body transport, the
/// bearer header, one shared refresh, sign-out device-first, account deletion server-first, and
/// no token in any log or report.
final class SessionClientTests: XCTestCase {
    private var vault: InMemorySessionVault!
    private var log: FailureLog!

    override func setUp() {
        super.setUp()
        vault = InMemorySessionVault()
        log = FailureLog()
        SessionStubProtocol.reset { _ in .failure(.unsupportedURL) }
    }

    private func makeClient() -> TranSessionClient {
        TranSessionClient(
            vault: vault,
            baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: SessionStubProtocol.session(),
            log: log.record
        )
    }

    /// Every token a test issued must be absent from every log line and reporter event.
    private func assertNoTokenLogged(_ tokens: [String], file: StaticString = #filePath, line: UInt = #line) {
        for rendering in log.renderings {
            for token in tokens {
                XCTAssertFalse(rendering.contains(token), "token in \(rendering)", file: file, line: line)
            }
        }
    }

    // MARK: - Sign in

    func testSignInUsesTheBodyTransportAndKeepsTheAccessTokenInMemoryOnly() async throws {
        SessionStubProtocol.reset { request in
            switch request.path {
            case "/api/auth/session" where request.method == "POST":
                return .status(201, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
            case "/api/auth/session":
                return request.authorization == "Bearer access-1"
                    ? .status(200, body: #"{"user_id":"voter-001","role":"citizen_voter"}"#)
                    : .status(401, body: SessionWire.expired)
            default: return .failure(.unsupportedURL)
            }
        }
        let client = makeClient()

        let stored = try await client.signIn(role: .citizenVoter)

        let signIn = try XCTUnwrap(SessionStubProtocol.requests.first)
        XCTAssertEqual(signIn.body, ["role": "citizen_voter", "transport": "body"])
        XCTAssertNil(signIn.authorization)
        XCTAssertEqual(stored, TranStoredSession(refreshToken: "refresh-1", userId: "voter-001", roleWire: "citizen_voter"))
        XCTAssertEqual(vault.load(), stored, "the vault holds the refresh credential, user and role")
        // The stored record has no access-token field; its encoding never contains one.
        let encoded = String(decoding: try JSONEncoder().encode(stored), as: UTF8.self)
        XCTAssertFalse(encoded.contains("access-1"))
        XCTAssertFalse(String(describing: stored).contains("refresh-1"), "printing redacts the token")
        XCTAssertFalse(String(reflecting: stored).contains("refresh-1"))

        // The access token is attached from memory, never put in the URL (REQ-SEC-017).
        let validation = await client.validate()
        XCTAssertEqual(validation, .valid)
        let check = try XCTUnwrap(SessionStubProtocol.requests.last)
        XCTAssertEqual(check.authorization, "Bearer access-1")
        XCTAssertFalse(SessionStubProtocol.requests.contains { $0.path.contains("access-1") })
    }

    func testSignInThatCannotReachTheApiStoresNothingAndLogsNoToken() async {
        SessionStubProtocol.reset { _ in .failure(.cannotConnectToHost) }
        let client = makeClient()

        do {
            try await client.signIn(role: .electionAuditor)
            XCTFail("expected a failure")
        } catch let failure as TranRequestFailure {
            XCTAssertEqual(failure.code, .networkOffline)
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertNil(vault.load())
        XCTAssertTrue(log.entries.isEmpty, "thrown, so its handler logs it, not the client (REQ-ROB-007)")
    }

    // MARK: - Refresh (REQ-SEC-016)

    func testConcurrentUnauthorizedCallsShareOneRefreshAndEachRepeatsOnce() async throws {
        try vault.save(SessionWire.stored(refresh: "refresh-0"))
        SessionStubProtocol.reset { request in
            switch request.path {
            case "/api/auth/refresh":
                // Slow enough that every other 401 arrives while it is in flight.
                return request.body["refresh_token"] == "refresh-0"
                    ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"), delay: 0.3)
                    : .status(401, body: SessionWire.expired)
            default:
                return request.authorization == "Bearer access-1"
                    ? .status(200, body: "{}")
                    : .status(401, body: SessionWire.expired)
            }
        }
        let client = makeClient()
        // Give the client a stale access token, so every call is sent and answers 401.
        _ = try? await client.authorized(path: "/warm-up")
        SessionStubProtocol.reset { request in
            switch request.path {
            case "/api/auth/refresh":
                return request.body["refresh_token"] == "refresh-1"
                    ? .status(200, body: SessionWire.pair(access: "access-2", refresh: "refresh-2"), delay: 0.3)
                    : .status(401, body: SessionWire.expired)
            default:
                return request.authorization == "Bearer access-2"
                    ? .status(200, body: "{}")
                    : .status(401, body: SessionWire.expired)
            }
        }

        let calls = 5
        try await withThrowingTaskGroup(of: Data.self) { group in
            for index in 0..<calls {
                group.addTask { try await client.authorized(path: "/api/call/\(index)") }
            }
            for try await _ in group {}
        }

        XCTAssertEqual(SessionStubProtocol.requests(to: "/api/auth/refresh").count, 1, "one refresh")
        for index in 0..<calls {
            let sent = SessionStubProtocol.requests(to: "/api/call/\(index)")
            XCTAssertEqual(sent.map(\.authorization), ["Bearer access-1", "Bearer access-2"], "call \(index)")
        }
        XCTAssertEqual(vault.load()?.refreshToken, "refresh-2", "the rotated token replaces the spent one")
        assertNoTokenLogged(["access-1", "access-2", "refresh-0", "refresh-1", "refresh-2"])
    }

    func testARestoredSessionRefreshesBeforeItsFirstCall() async throws {
        try vault.save(SessionWire.stored(refresh: "refresh-0"))
        SessionStubProtocol.reset { request in
            request.path == "/api/auth/refresh"
                ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
                : .status(200, body: "{}")
        }

        _ = try await makeClient().authorized(path: "/api/auth/session")

        XCTAssertEqual(SessionStubProtocol.requests.map(\.path), ["/api/auth/refresh", "/api/auth/session"])
        XCTAssertEqual(SessionStubProtocol.requests.last?.authorization, "Bearer access-1")
        XCTAssertEqual(SessionStubProtocol.requests.first?.body, ["refresh_token": "refresh-0"])
    }

    func testA401AfterTheRepeatSignsOut() async throws {
        try vault.save(SessionWire.stored(refresh: "refresh-0"))
        SessionStubProtocol.reset { request in
            request.path == "/api/auth/refresh"
                ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
                : .status(401, body: SessionWire.expired)
        }

        do {
            _ = try await makeClient().authorized(path: "/api/auth/session")
            XCTFail("expected the session to end")
        } catch {
            XCTAssertEqual(error as? TranRequestFailure, TranSessionClient.expired)
        }
        XCTAssertEqual(SessionStubProtocol.requests(to: "/api/auth/refresh").count, 1, "refresh once only")
        XCTAssertNil(vault.load())
        assertNoTokenLogged(["access-1", "refresh-0", "refresh-1"])
    }

    func testARejectedRefreshSignsOutAndAFailedOneKeepsTheSession() async throws {
        for (reply, keeps) in [
            (SessionStubProtocol.Reply.status(401, body: SessionWire.expired), false),
            (.status(403, body: "{}"), false),
            (.status(503, body: "{}"), true),
            (.status(429, body: "{}"), true),
            (.failure(.notConnectedToInternet), true),
            (.failure(.timedOut), true),
        ] {
            vault.clear()
            try vault.save(SessionWire.stored(refresh: "refresh-0"))
            SessionStubProtocol.reset { _ in reply }

            let outcome = await makeClient().validate()

            XCTAssertEqual(outcome, keeps ? .kept : .signedOut, "\(reply)")
            XCTAssertEqual(vault.load() != nil, keeps, "\(reply)")
            XCTAssertEqual(SessionStubProtocol.requests.map(\.path), ["/api/auth/refresh"], "\(reply)")
        }
        assertNoTokenLogged(["refresh-0"])
    }

    func testNoStoredSessionSignsOutWithoutARequest() async {
        let outcome = await makeClient().validate()

        XCTAssertEqual(outcome, .signedOut)
        XCTAssertTrue(SessionStubProtocol.requests.isEmpty)
    }

    // MARK: - Sign out (REQ-SEC-022)

    func testSignOutClearsTheDeviceBeforeCallingTheServer() async throws {
        SessionStubProtocol.reset { request in
            request.path == "/api/auth/session"
                ? .status(201, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
                : .status(204, body: "")
        }
        let client = makeClient()
        try await client.signIn(role: .citizenVoter)
        let vault = self.vault!
        let vaultAtSignOut = LockedFlag()
        SessionStubProtocol.reset { request in
            if request.path == "/api/auth/sign-out" { vaultAtSignOut.set(vault.load() != nil) }
            return .status(204, body: "")
        }

        await client.signOut()

        let signOut = try XCTUnwrap(SessionStubProtocol.requests(to: "/api/auth/sign-out").first)
        XCTAssertEqual(signOut.body, ["refresh_token": "refresh-1"])
        XCTAssertEqual(vaultAtSignOut.value, false, "the vault was empty when the server was called")
        XCTAssertNil(vault.load())
        // The access token went with it: the next call sends nothing and ends the session.
        let outcome = await client.validate()
        XCTAssertEqual(outcome, .signedOut)
        XCTAssertEqual(SessionStubProtocol.requests.count, 1)
    }

    func testAnUnreachableSignOutStillSignsTheDeviceOut() async throws {
        try vault.save(SessionWire.stored(refresh: "refresh-0"))
        SessionStubProtocol.reset { _ in .failure(.cannotConnectToHost) }

        await makeClient().signOut()

        XCTAssertNil(vault.load())
        XCTAssertEqual(SessionStubProtocol.requests.map(\.path), ["/api/auth/sign-out"])
        XCTAssertEqual(log.entries.map(\.code), [.networkOffline], "swallowed here, so logged here")
        assertNoTokenLogged(["refresh-0"])
    }

    func testSignOutWithoutASessionMakesNoRequest() async {
        await makeClient().signOut()

        XCTAssertTrue(SessionStubProtocol.requests.isEmpty)
    }

    func testARefreshThatLandsAfterSignOutIsDiscarded() async throws {
        try vault.save(SessionWire.stored(refresh: "refresh-0"))
        SessionStubProtocol.reset { request in
            request.path == "/api/auth/refresh"
                ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"), delay: 0.3)
                : .status(204, body: "")
        }
        let client = makeClient()

        async let validation = client.validate()
        try await Task.sleep(nanoseconds: 100_000_000)
        await client.signOut()

        let outcome = await validation
        XCTAssertEqual(outcome, .signedOut)
        XCTAssertNil(vault.load(), "a late refresh must not sign the user back in")
    }

    // MARK: - Delete the account (REQ-ACC-006)

    /// A client signed in as `access-1` / `refresh-1`, with the transport then answering `reply`.
    private func signedInClient(_ reply: @escaping @Sendable (SessionStubProtocol.Recorded) -> SessionStubProtocol.Reply)
        async throws -> TranSessionClient
    {
        SessionStubProtocol.reset { _ in .status(201, body: SessionWire.pair(access: "access-1", refresh: "refresh-1")) }
        let client = makeClient()
        try await client.signIn(role: .citizenVoter)
        SessionStubProtocol.reset(reply)
        return client
    }

    private func deletionFailure(_ client: TranSessionClient) async -> TranRequestFailure? {
        do {
            try await client.deleteAccount()
            return nil
        } catch {
            return error as? TranRequestFailure
        }
    }

    func testA204DeletesTheAccountAndOnlyThenClearsTheDevice() async throws {
        let vault = self.vault!
        let vaultAtDeletion = LockedFlag()
        let client = try await signedInClient { request in
            if request.path == "/api/account" { vaultAtDeletion.set(vault.load() != nil) }
            return .status(204, body: "")
        }

        try await client.deleteAccount()

        let deletion = try XCTUnwrap(SessionStubProtocol.requests(to: "/api/account").first)
        XCTAssertEqual(deletion.method, "DELETE")
        XCTAssertEqual(deletion.authorization, "Bearer access-1")
        XCTAssertEqual(deletion.body, [:], "no body")
        XCTAssertEqual(vaultAtDeletion.value, true, "the device still held the session while the server decided")
        XCTAssertNil(vault.load())
        // The access token went too: the next call has nothing to send and ends there.
        let outcome = await client.validate()
        XCTAssertEqual(outcome, .signedOut)
        XCTAssertEqual(SessionStubProtocol.requests.count, 1)
        assertNoTokenLogged(["access-1", "refresh-1"])
    }

    func testADeletionThatFailsKeepsTheSessionOnTheDevice() async throws {
        for (reply, code) in [
            (SessionStubProtocol.Reply.failure(.cannotConnectToHost), TranErrorCode.networkOffline),
            (.failure(.timedOut), .networkTimeout),
            (.status(500, body: #"{"success":false,"error":"x","code":"server.internal","request_id":"req-7"}"#), .serverInternal),
            (.status(503, body: "{}"), .serverUnavailable),
        ] {
            vault.clear()
            let client = try await signedInClient { _ in reply }

            let failure = await deletionFailure(client)

            XCTAssertEqual(failure?.code, code, "\(reply)")
            XCTAssertEqual(vault.load()?.refreshToken, "refresh-1", "\(reply): the vault is untouched")
            // The access token is kept in memory: a retry sends it again, without a refresh.
            SessionStubProtocol.reset { _ in .status(204, body: "") }
            try await client.deleteAccount()
            XCTAssertEqual(SessionStubProtocol.requests.map(\.authorization), ["Bearer access-1"], "\(reply)")
        }
        assertNoTokenLogged(["access-1", "refresh-1"])
    }

    func testA401DuringDeletionRefreshesOnceAndRepeats() async throws {
        let client = try await signedInClient { request in
            switch request.path {
            case "/api/auth/refresh":
                return .status(200, body: SessionWire.pair(access: "access-2", refresh: "refresh-2"))
            default:
                return request.authorization == "Bearer access-2"
                    ? .status(204, body: "")
                    : .status(401, body: SessionWire.expired)
            }
        }

        try await client.deleteAccount()

        XCTAssertEqual(SessionStubProtocol.requests.map(\.path), ["/api/account", "/api/auth/refresh", "/api/account"])
        XCTAssertEqual(SessionStubProtocol.requests.last?.authorization, "Bearer access-2")
        XCTAssertNil(vault.load())
        assertNoTokenLogged(["access-1", "access-2", "refresh-1", "refresh-2"])
    }

    func testADeadSessionDuringDeletionEndsLikeAnyOther() async throws {
        let client = try await signedInClient { _ in .status(401, body: SessionWire.expired) }

        let failure = await deletionFailure(client)

        XCTAssertEqual(failure, TranSessionClient.expired, "the recovery table signs out")
        XCTAssertEqual(SessionStubProtocol.requests.map(\.path), ["/api/account", "/api/auth/refresh"])
        XCTAssertNil(vault.load())
    }

    /// The debug launch preset opens a dashboard with no credential at all. Deletion still asks the
    /// server, so an unreachable API is a network failure, never "signed out".
    func testWithoutAnyCredentialTheServerStillAnswers() async throws {
        SessionStubProtocol.reset { _ in .failure(.cannotConnectToHost) }
        let client = makeClient()

        let offline = await deletionFailure(client)

        XCTAssertEqual(offline?.code, .networkOffline)
        let sent = try XCTUnwrap(SessionStubProtocol.requests.first)
        XCTAssertEqual([sent.method, sent.path], ["DELETE", "/api/account"])
        XCTAssertNil(sent.authorization)
        XCTAssertEqual(SessionStubProtocol.requests.count, 1)

        SessionStubProtocol.reset { _ in .status(401, body: SessionWire.expired) }
        let rejected = await deletionFailure(client)

        XCTAssertEqual(rejected, TranSessionClient.expired, "the server's 401 goes through the table")
        XCTAssertEqual(SessionStubProtocol.requests.map(\.path), ["/api/account"], "nothing to refresh with")
    }

    func testConcurrentDeletionsSendOneRequestAndShareItsAnswer() async throws {
        let client = try await signedInClient { _ in .status(204, body: "", delay: 0.3) }

        async let first: Void = client.deleteAccount()
        async let second: Void = client.deleteAccount()
        _ = try await (first, second)

        XCTAssertEqual(SessionStubProtocol.requests(to: "/api/account").count, 1, "one DELETE")
        XCTAssertNil(vault.load())

        // The flight is over: a later call is a new request (and the server's 401 for it).
        SessionStubProtocol.reset { _ in .status(401, body: SessionWire.expired) }
        let later = await deletionFailure(client)
        XCTAssertEqual(later, TranSessionClient.expired)
        XCTAssertEqual(SessionStubProtocol.requests(to: "/api/account").count, 1)
    }

    /// The client logs only what it swallows; what it throws is its handler's to log (REQ-ROB-007).
    func testEveryFailedRequestIsLoggedOnce() async throws {
        let client = try await signedInClient { _ in .status(401, body: SessionWire.expired) }

        let failure = await deletionFailure(client)

        XCTAssertEqual(failure, TranSessionClient.expired)
        // Two failed requests, two events: the DELETE's 401, which the client recovered from with
        // a refresh, here; the refresh's 401 ends the session and is thrown, so the handler logs
        // that one (`AccountDeletionTests`).
        XCTAssertEqual(log.entries.map(\.status), [401])

        // No credential at all: no request is sent, and the table's answer goes to the caller.
        log = FailureLog()
        let outcome = await makeClient().validate()
        XCTAssertEqual(outcome, .signedOut)
        XCTAssertTrue(log.entries.isEmpty, "the caller presents it, so the caller logs it")

        // A restored session that is kept: the failure is shown nowhere, so the client logs it.
        log = FailureLog()
        try vault.save(SessionWire.stored(refresh: "refresh-0"))
        SessionStubProtocol.reset { _ in .status(503, body: "{}") }
        let kept = await makeClient().validate()
        XCTAssertEqual(kept, .kept)
        XCTAssertEqual(log.entries.map(\.code), [.serverUnavailable])
    }
}

/// A Bool written from the transport's thread and read by the test.
final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Bool?
    var value: Bool? { lock.withLock { stored } }
    func set(_ newValue: Bool) { lock.withLock { stored = newValue } }
}
