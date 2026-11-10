// Verifies: REQ-PSH-008 REQ-PRV-003 REQ-PRV-004
import UserNotifications
import XCTest

/// "Notify me when I can vote" against the fake gateways, mirroring the location tests: nothing is
/// asked before a tap and the priming, a refusal changes nothing, a permanent one offers Settings,
/// and only a granted permission asks the push gateway for a token.
@MainActor
final class NotifyPermissionTests: XCTestCase {
    private var gateway: FakePermissionGateway!
    private var push: FakePushGateway!

    override func setUp() async throws {
        try await super.setUp()
        gateway = FakePermissionGateway()
        push = FakePushGateway(available: true, tokenOnRegister: TranPushLaunch.fakeToken)
    }

    private func flow(_ status: TranPermissionStatus? = nil) -> TranNotifyPermission {
        if let status { gateway.statuses[.notifications] = status }
        return TranNotifyPermission(gateway: gateway, push: push)
    }

    func testNothingIsAskedBeforeATap() {
        _ = flow()

        XCTAssertTrue(gateway.requests.isEmpty)
        XCTAssertEqual(push.registrations, 0)
    }

    func testTheFirstTapExplainsFirstAndAsksNothing() async {
        let notify = flow(.notDetermined)

        await notify.use()

        XCTAssertEqual(notify.phase, .priming)
        XCTAssertTrue(gateway.requests.isEmpty, "no system prompt before Continue")
        XCTAssertEqual(push.registrations, 0)
    }

    func testNotNowIsNotARefusal() async {
        let notify = flow(.notDetermined)
        await notify.use()

        notify.notNow()

        XCTAssertEqual(notify.phase, .idle)
        XCTAssertEqual(gateway.status(of: .notifications), .notDetermined)
        await notify.use()
        XCTAssertEqual(notify.phase, .priming)
        XCTAssertTrue(gateway.requests.isEmpty)
    }

    func testContinueAsksOnceThenAsksThePushGatewayForAToken() async {
        gateway.answer = .granted
        let notify = flow(.notDetermined)
        await notify.use()

        await notify.continueAfterPriming()

        XCTAssertEqual(gateway.requests, [.notifications], "one system prompt, after Continue")
        XCTAssertEqual(push.registrations, 1)
        XCTAssertEqual(push.token, TranPushLaunch.fakeToken)
        XCTAssertEqual(notify.phase, .idle)
    }

    func testAGrantedPermissionGoesStraightToTheToken() async {
        let notify = flow(.granted)

        await notify.use()

        XCTAssertTrue(gateway.requests.isEmpty)
        XCTAssertEqual(push.registrations, 1)
    }

    func testRefusingTheSystemPromptChangesNothingAndShowsNoNoteYet() async {
        gateway.answer = .deniedPermanently
        let notify = flow(.notDetermined)
        await notify.use()

        await notify.continueAfterPriming()

        XCTAssertEqual(notify.phase, .idle, "no error and no nagging right after the refusal")
        XCTAssertEqual(push.registrations, 0, "no reminder: the catalogue's fallback")
        await notify.use()
        XCTAssertEqual(notify.phase, .settingsOffered)
        XCTAssertEqual(gateway.requests, [.notifications], "never asks again")
    }

    func testAPermanentRefusalOffersSettingsAndOpensThem() async {
        let notify = flow(.deniedPermanently)

        await notify.use()
        notify.openSettings()

        XCTAssertEqual(notify.phase, .settingsOffered)
        XCTAssertEqual(gateway.settingsOpened, 1)
        XCTAssertTrue(gateway.requests.isEmpty)
        XCTAssertEqual(push.registrations, 0)
    }

    func testWithoutPushTheControlIsNotOfferedAndATapDoesNothing() async {
        push = FakePushGateway(available: false)
        let notify = flow(.notDetermined)

        await notify.use()

        XCTAssertFalse(notify.isOffered)
        XCTAssertEqual(notify.phase, .idle)
        XCTAssertTrue(gateway.requests.isEmpty)
    }

    func testTheCopyComesFromTheCatalogueKeys() {
        let entry = TranNotifyPermission.entry
        XCTAssertEqual(entry.fallback, .noReminder)
        XCTAssertEqual(entry.iosUsageDescriptions, [], "iOS asks without a usage description")
        for key in [entry.primingTitleKey, entry.primingBodyKey, entry.purposeKey, entry.settingsNoteKey] {
            XCTAssertNotNil(TranNotifyPermission.localized(key), key)
        }
        XCTAssertNil(TranNotifyPermission.localized("eligibility.location.primingTitle"))
        XCTAssertEqual(TranNotifyPermission.primingTitle, L10n.Eligibility.notifyPrimingTitle)
        XCTAssertEqual(TranNotifyPermission.primingBody, L10n.Eligibility.notifyPrimingBody)
        XCTAssertEqual(TranNotifyPermission.settingsNote, L10n.Eligibility.notifySettingsNote)
    }

    func testIOSNotificationAnswersMapToTheSharedStatuses() {
        typealias Gateway = SystemPermissionGateway
        XCTAssertEqual(Gateway.status(UNAuthorizationStatus.notDetermined), .notDetermined)
        XCTAssertEqual(Gateway.status(UNAuthorizationStatus.denied), .deniedPermanently, "iOS asks once")
        XCTAssertEqual(Gateway.status(UNAuthorizationStatus.authorized), .granted)
        XCTAssertEqual(Gateway.status(UNAuthorizationStatus.provisional), .granted)
        XCTAssertEqual(Gateway.status(UNAuthorizationStatus.ephemeral), .granted)
    }

    /// The UI test presets: push is staged only by a `notifications` permission given.
    func testUITestPresetsStagePushOnlyThroughTheNotificationsGiven() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "NotifyPermissionTests"))
        defer { defaults.removePersistentDomain(forName: "NotifyPermissionTests") }

        XCTAssertTrue(TranPushLaunch.gateway(defaults: defaults) is SystemPushGateway, "no preset: the system's")

        defaults.set("citizen_voter", forKey: AuthSession.launchPresetKey)
        let plain = try XCTUnwrap(TranPushLaunch.gateway(defaults: defaults) as? FakePushGateway)
        XCTAssertFalse(plain.isAvailable, "without the given, push is unavailable")

        defaults.set("location_approximate=granted", forKey: TranPermissionLaunch.presetKey)
        XCTAssertFalse(TranPushLaunch.gateway(defaults: defaults).isAvailable)

        defaults.set("notifications=granted", forKey: TranPermissionLaunch.presetKey)
        let staged = try XCTUnwrap(TranPushLaunch.gateway(defaults: defaults) as? FakePushGateway)
        XCTAssertTrue(staged.isAvailable)
        XCTAssertNil(staged.token, "no token until asked")
        staged.registerForPush()
        XCTAssertEqual(staged.token, TranPushLaunch.fakeToken)
        XCTAssertEqual(TranPushLaunch.fakeToken.count, 64)
    }
}
