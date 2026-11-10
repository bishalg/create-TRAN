// Verifies: REQ-PSH-009 REQ-PSH-010 REQ-PSH-011 REQ-PSH-012
import XCTest

/// The device registration on a scripted API (ADR-0023) and the fake push gateway: every move is
/// `pushSync`'s, the calls go through the session client with the bearer, the record lives in
/// ordinary app storage, and no token or installation id reaches a log.
@MainActor
final class PushRegistrationTests: XCTestCase {
    private static let tokenA = String(repeating: "a1", count: 32)
    private static let tokenB = String(repeating: "b2", count: 32)
    /// 2027-01-15T08:00:00Z, the device clock in every test.
    private static let start: Int64 = 1_799_996_400
    private static let day: Int64 = 86_400

    private var defaults: UserDefaults!
    private var vault: InMemorySessionVault!
    private var log: FailureLog!
    private var permissions: FakePermissionGateway!
    private var push: FakePushGateway!
    private var nowUnixS = start
    private var client: TranSessionClient!

    override func setUp() async throws {
        try await super.setUp()
        defaults = UserDefaults(suiteName: "PushRegistrationTests")
        defaults.removePersistentDomain(forName: "PushRegistrationTests")
        vault = InMemorySessionVault(SessionWire.stored())
        log = FailureLog()
        permissions = FakePermissionGateway([.notifications: .granted])
        push = FakePushGateway(available: true, tokenOnRegister: Self.tokenA)
        nowUnixS = Self.start
        client = TranSessionClient(
            vault: vault,
            baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: SessionStubProtocol.session(),
            log: log.record
        )
        Self.answer(devices: 204)
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: "PushRegistrationTests")
        try await super.tearDown()
    }

    /// Refresh answers a token pair; the device routes answer `devices`.
    private static func answer(devices status: Int) {
        SessionStubProtocol.reset { request in
            switch request.path {
            case "/api/auth/refresh":
                return .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
            case "/api/auth/sign-out":
                return .status(204)
            case let path where path.hasPrefix("/api/devices/"):
                return .status(status)
            default:
                return .failure(.unsupportedURL)
            }
        }
    }

    private var store: TranPushStore { TranPushStore(defaults: defaults) }

    private func registration() -> TranPushRegistration {
        TranPushRegistration(
            gateway: push,
            permissions: permissions,
            client: client,
            store: store,
            app: .init(environment: "sandbox", locale: "ne", version: "0.1.0"),
            now: { [unowned self] in Date(timeIntervalSince1970: TimeInterval(nowUnixS)) },
            log: log.record
        )
    }

    private var deviceCalls: [SessionStubProtocol.Recorded] {
        SessionStubProtocol.requests.filter { $0.path.hasPrefix("/api/devices/") }
    }

    private func json(_ request: SessionStubProtocol.Recorded) throws -> [String: AnyHashable] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: request.raw) as? [String: AnyHashable])
    }

    // MARK: - Register (REQ-PSH-009)

    func testLaunchWithPermissionAsksForATokenAndRegistersIt() async throws {
        let action = await registration().sync()

        XCTAssertEqual(action, .register)
        XCTAssertEqual(push.registrations, 1, "asked the system for a token")
        let put = try XCTUnwrap(deviceCalls.first)
        XCTAssertEqual(deviceCalls.count, 1)
        XCTAssertEqual(put.method, "PUT")
        XCTAssertEqual(put.path, "/api/devices/\(store.installationId)")
        XCTAssertEqual(put.authorization, "Bearer access-1")
        XCTAssertEqual(try json(put), [
            "platform": "ios", "push_token": Self.tokenA, "environment": "sandbox", "locale": "ne",
            "app_version": "0.1.0", "marketing": false,
        ])
        XCTAssertEqual(store.lastRegistration, TranLastRegistration(token: Self.tokenA, registeredAtUnixS: Self.start))
    }

    func testAnUnchangedTokenIsRegisteredAgainOnlyAfterAWeek() async {
        let sync = registration()
        await sync.sync()

        nowUnixS = Self.start + 7 * Self.day - 1
        let early = await sync.sync()
        XCTAssertEqual(early, .nothing)
        XCTAssertEqual(deviceCalls.count, 1)

        nowUnixS = Self.start + 7 * Self.day
        let weekly = await sync.sync()
        XCTAssertEqual(weekly, .register)
        XCTAssertEqual(deviceCalls.map(\.method), ["PUT", "PUT"])
        XCTAssertEqual(store.lastRegistration?.registeredAtUnixS, nowUnixS)
    }

    func testANewTokenFromTheSystemRunsTheSyncAndRegistersIt() async throws {
        let sync = registration()
        var opened = 0
        var shown = 0
        await sync.start(onOpened: { opened += 1 }, onForeground: { shown += 1 })
        // The first token's own sync: already registered, so it does nothing.
        let settled = await sync.tokenSync?.value
        XCTAssertEqual(settled, .nothing)
        XCTAssertEqual(deviceCalls.count, 1)
        let firstId = store.installationId

        push.token = Self.tokenB
        push.deliver(.tokenArrived)
        let action = await sync.tokenSync?.value

        XCTAssertEqual(action, .register)
        XCTAssertEqual(deviceCalls.count, 2)
        XCTAssertEqual(try json(deviceCalls[1])["push_token"], Self.tokenB)
        XCTAssertEqual(store.lastRegistration?.token, Self.tokenB)
        // Another token is another install or device: the id is new too (REQ-PSH-010).
        XCTAssertNotEqual(store.installationId, firstId)
        XCTAssertEqual(deviceCalls[1].path, "/api/devices/\(store.installationId)")
        XCTAssertEqual(opened + shown, 0)

        push.deliver(.opened)
        push.deliver(.arrivedInForeground)
        XCTAssertEqual(opened, 1)
        XCTAssertEqual(shown, 1)
    }

    func testAfterSignInTheSyncRegisters() async throws {
        vault.clear()
        let sync = registration()
        let before = await sync.sync()
        XCTAssertEqual(before, .nothing, "no API session yet")
        XCTAssertTrue(deviceCalls.isEmpty)

        SessionStubProtocol.reset { request in
            switch request.path {
            case "/api/auth/session":
                return .status(201, body: SessionWire.pair(access: "access-2", refresh: "refresh-2"))
            default:
                return .status(204)
            }
        }
        try await client.signIn(role: .citizenVoter)
        let after = await sync.sync()

        XCTAssertEqual(after, .register)
        XCTAssertEqual(deviceCalls.first?.authorization, "Bearer access-2")
    }

    // MARK: - Unregister (REQ-PSH-009)

    func testTurningNotificationsOffUnregisters() async throws {
        let sync = registration()
        await sync.sync()

        permissions.statuses[.notifications] = .deniedPermanently
        let action = await sync.sync()

        XCTAssertEqual(action, .unregister)
        XCTAssertNil(store.lastRegistration, "the record is cleared")
        let delete = try XCTUnwrap(deviceCalls.last)
        XCTAssertEqual(delete.method, "DELETE")
        XCTAssertEqual(delete.path, "/api/devices/\(store.installationId)")
        XCTAssertEqual(delete.authorization, "Bearer access-1")
        let again = await sync.sync()
        XCTAssertEqual(again, .nothing, "nothing recorded, nothing to do")
    }

    func testWithoutAnApiSessionNothingIsSent() async {
        vault.clear()

        let action = await registration().sync()

        XCTAssertEqual(action, .nothing)
        XCTAssertTrue(SessionStubProtocol.requests.isEmpty)
        XCTAssertNil(store.lastRegistration)
    }

    func testASessionThatEndedElsewhereForgetsTheRecordWithoutACall() async {
        store.record(TranLastRegistration(token: Self.tokenA, registeredAtUnixS: Self.start))
        vault.clear()

        let action = await registration().sync()

        XCTAssertEqual(action, .unregister)
        XCTAssertNil(store.lastRegistration)
        XCTAssertTrue(SessionStubProtocol.requests.isEmpty, "nothing to authenticate a DELETE with")
    }

    // MARK: - Sign-out (REQ-PSH-011)

    func testSignOutForgetsTheRegistrationAndDeletesItBeforeTheSessionEnds() async throws {
        let sync = registration()
        await sync.sync()

        await sync.signOut()
        await client.signOut()

        XCTAssertNil(store.lastRegistration)
        let paths = SessionStubProtocol.requests.map { "\($0.method) \($0.path)" }
        let delete = "DELETE /api/devices/\(store.installationId)"
        XCTAssertEqual(paths.suffix(2), [delete, "POST /api/auth/sign-out"], "DELETE first, then the session ends")
        XCTAssertEqual(deviceCalls.last?.authorization, "Bearer access-1")
        XCTAssertNil(vault.load())
    }

    func testAFailedDeleteChangesNothingAboutSignOut() async {
        let sync = registration()
        await sync.sync()
        Self.answer(devices: 503)

        await sync.signOut()
        await client.signOut()

        XCTAssertNil(store.lastRegistration)
        XCTAssertNil(vault.load(), "signed out anyway")
        XCTAssertEqual(log.entries.map(\.status), [503], "logged once")
    }

    func testSignOutWithNothingRecordedSendsNoDelete() async {
        await registration().signOut()

        XCTAssertTrue(deviceCalls.isEmpty)
    }

    // MARK: - Availability (REQ-PSH-012)

    func testTheFirstLaunchCreatesTheInstallationIdEvenWithoutPush() async {
        push = FakePushGateway(available: false)
        XCTAssertNil(defaults.string(forKey: TranPushStore.installationKey))

        await registration().start(onOpened: {}, onForeground: {})

        XCTAssertNotNil(UUID(uuidString: defaults.string(forKey: TranPushStore.installationKey) ?? ""))
        XCTAssertTrue(SessionStubProtocol.requests.isEmpty, "created, and sent nowhere")
    }

    func testWithoutPushNothingIsAskedOrSentAndTheControlIsHidden() async {
        push = FakePushGateway(available: false, tokenOnRegister: Self.tokenA)

        let action = await registration().sync()

        XCTAssertEqual(action, .nothing)
        XCTAssertEqual(push.registrations, 0)
        XCTAssertTrue(SessionStubProtocol.requests.isEmpty)
        XCTAssertTrue(permissions.requests.isEmpty)
        XCTAssertFalse(TranNotifyPermission(gateway: permissions, push: push).isOffered)
        XCTAssertTrue(TranNotifyPermission(gateway: permissions, push: FakePushGateway(available: true)).isOffered)
    }

    func testTheBuildSwitchIsReadFromInfoPlist() {
        XCTAssertEqual(TranPushBuild.from(info: nil), TranPushBuild(enabled: false, environment: "sandbox"))
        XCTAssertEqual(TranPushBuild.from(info: ["TranPushEnabled": "NO"]).enabled, false)
        XCTAssertEqual(TranPushBuild.from(info: ["TranPushEnabled": "$(TRAN_PUSH_ENABLED)"]).enabled, false)
        XCTAssertEqual(
            TranPushBuild.from(info: ["TranPushEnabled": "YES", "TranApsEnvironment": "production"]),
            TranPushBuild(enabled: true, environment: "production"))
        XCTAssertEqual(TranPushBuild.from(info: ["TranApsEnvironment": "development"]).environment, "sandbox")
        // This test build is the default one: push off, so the system gateway reports unavailable.
        XCTAssertFalse(TranPushBuild.current.enabled)
        XCTAssertFalse(SystemPushGateway(build: .current).isAvailable)
    }

    func testTheSystemTokenIsLowercaseHex() {
        XCTAssertEqual(SystemPushGateway.hex(Data([0x00, 0xAB, 0x0F, 0xFF])), "00ab0fff")
    }

    // MARK: - The installation id (REQ-PSH-010)

    func testTheInstallationIdIsARandomUUIDKeptInAppStorage() throws {
        let id = store.installationId

        let uuid = try XCTUnwrap(UUID(uuidString: id))
        XCTAssertEqual(id, id.lowercased())
        XCTAssertEqual(uuid.uuid.6 >> 4, 4, "version 4: random")
        XCTAssertEqual(store.installationId, id, "kept")
        XCTAssertEqual(defaults.string(forKey: TranPushStore.installationKey), id)
        let other = try XCTUnwrap(UserDefaults(suiteName: "PushRegistrationTests.other"))
        defer { other.removePersistentDomain(forName: "PushRegistrationTests.other") }
        XCTAssertNotEqual(TranPushStore(defaults: other).installationId, id, "another install, another id")
    }

    /// A backup restored onto another phone, or a device-to-device transfer, brings the app's
    /// `UserDefaults` along; the new phone's token tells the copy apart before anything is sent.
    func testAnIdCopiedToAnotherDeviceIsReplacedBeforeItIsRegistered() async throws {
        let original = store.installationId
        store.bind(token: Self.tokenB)
        store.record(TranLastRegistration(token: Self.tokenB, registeredAtUnixS: Self.start))

        await registration().sync()

        XCTAssertNotEqual(store.installationId, original)
        XCTAssertEqual(deviceCalls.map(\.path), ["/api/devices/\(store.installationId)"])
        XCTAssertEqual(store.lastRegistration?.token, Self.tokenA)
    }

    func testTheFirstTokenKeepsTheIdAndTheSameTokenNeverChangesIt() {
        let id = store.installationId
        XCTAssertFalse(store.bind(token: Self.tokenA))
        XCTAssertFalse(store.bind(token: Self.tokenA))
        XCTAssertEqual(store.installationId, id)
        XCTAssertTrue(store.bind(token: Self.tokenB))
        XCTAssertNotEqual(store.installationId, id)
    }

    // MARK: - Nothing in a log (REQ-PSH-007 on the device)

    func testNoTokenOrInstallationIdIsLogged() async {
        Self.answer(devices: 503)
        let sync = registration()

        await sync.sync()
        permissions.statuses[.notifications] = .deniedPermanently
        store.record(TranLastRegistration(token: Self.tokenA, registeredAtUnixS: Self.start))
        await sync.sync()

        XCTAssertEqual(log.entries.count, 2, "the failed PUT and the failed DELETE, once each")
        for rendering in log.renderings {
            for secret in [Self.tokenA, store.installationId] {
                XCTAssertFalse(rendering.contains(secret), "\(secret) in \(rendering)")
            }
        }
    }
}
