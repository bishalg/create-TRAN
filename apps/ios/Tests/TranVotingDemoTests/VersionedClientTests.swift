// Verifies: REQ-VER-001 REQ-VER-004 REQ-VER-009 REQ-VER-010
import XCTest

/// The session client under spec 028: every request on the versioned path with `X-Tran-Client`,
/// a `426` raises the update signal and leaves the session alone, and a nudge reaches the app
/// whichever call met it.
final class VersionedClientTests: XCTestCase {
    private var vault: InMemorySessionVault!
    private var signals: SignalLog!

    override func setUp() {
        super.setUp()
        vault = InMemorySessionVault(SessionWire.stored(refresh: "refresh-0"))
        signals = SignalLog()
        SessionStubProtocol.reset { _ in .failure(.unsupportedURL) }
    }

    private func makeClient() -> TranSessionClient {
        TranSessionClient(
            vault: vault,
            baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: SessionStubProtocol.session(),
            log: FailureLog().record,
            client: "ios/9.9.9",
            onStanding: signals.record
        )
    }

    private static let upgrade =
        #"{"success":false,"error":"Update","code":"client.upgrade_required","retryable":false,"request_id":"req-426"}"#

    func testA426KeepsTheSessionAndRaisesTheUpdateScreen() async throws {
        SessionStubProtocol.reset { _ in .status(426, body: Self.upgrade) }
        let client = makeClient()

        // The restored session's first call refreshes; the refresh itself answers 426.
        let outcome = await client.validate()

        XCTAssertEqual(outcome, .kept, "a blocked version is not a dead credential")
        XCTAssertEqual(vault.load()?.refreshToken, "refresh-0", "the vault is never cleared by a 426")
        let hasSession = await client.hasApiSession()
        XCTAssertTrue(hasSession)
        XCTAssertEqual(signals.entries, [.upgradeRequired])
        XCTAssertEqual(SessionStubProtocol.requests.map(\.path), [TranEndpoint.refresh.path()], "sent once")
    }

    func testA426OnAnAuthorisedCallIsThrownAsTheUpgradeCode() async throws {
        SessionStubProtocol.reset { request in
            request.path == TranEndpoint.refresh.path()
                ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
                : .status(426, body: Self.upgrade)
        }
        do {
            _ = try await makeClient().deleteAccount()
            XCTFail("a blocked version cannot delete")
        } catch let failure as TranRequestFailure {
            XCTAssertEqual(failure.code, .clientUpgradeRequired)
            XCTAssertEqual(failure.status, 426)
        }
        XCTAssertEqual(vault.load()?.refreshToken, "refresh-1", "the account and the session stay")
        XCTAssertEqual(signals.entries, [.upgradeRequired])
    }

    func testEveryRequestIsVersionedAndNamesTheClient() async throws {
        SessionStubProtocol.reset { request in
            request.path == TranEndpoint.refresh.path()
                ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
                : .status(204, body: "")
        }
        let client = makeClient()
        _ = try await client.authorized(.registerDevice, installationId: "id-1", body: Data("{}".utf8))
        await client.signOut()

        let sent = SessionStubProtocol.requests
        XCTAssertEqual(sent.map(\.path), [
            ApiContract.basePath + "/auth/refresh",
            ApiContract.basePath + "/devices/id-1",
            ApiContract.basePath + "/auth/sign-out",
        ])
        XCTAssertEqual(sent.map(\.client), Array(repeating: "ios/9.9.9", count: 3))
    }

    func testANudgeOnAnyAnswerReachesTheApp() async throws {
        let nudge = [ApiContract.updateHeader: ApiContract.updateRecommended, ApiContract.recommendedVersionHeader: "1.5.0"]
        SessionStubProtocol.reset { request in
            request.path == TranEndpoint.refresh.path()
                ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"), headers: nudge)
                : .status(200, body: "{}", headers: nudge)
        }
        let outcome = await makeClient().validate()
        XCTAssertEqual(outcome, .valid, "a nudge changes nothing else about the answer")
        XCTAssertEqual(signals.entries, [.updateRecommended(version: "1.5.0"), .updateRecommended(version: "1.5.0")])
    }
}
