// Verifies: REQ-VER-004 REQ-VER-009 REQ-VER-010 REQ-VER-011
import XCTest

/// What the app does with what the API says about its version (spec 028): the client identity it
/// sends, how an answer becomes a signal, the blocking screen's state, the prompt once per
/// recommended version, and the store page from the build configuration.
@MainActor
final class UpdateCenterTests: XCTestCase {
    private let suite = "UpdateCenterTests"
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    // MARK: - Identity (REQ-VER-004)

    func testTheAppNamesItselfWithTheReleasedVersion() throws {
        // The app bundle is the test host: its CFBundleShortVersionString is the one version
        // `pnpm release` writes everywhere (ADR-0034).
        let header = TranClientIdentity.header(bundle: .main)
        XCTAssertEqual(header, formatClient(platform: .ios, version: try RepoFixtures.treeVersion()))
        XCTAssertEqual(parseClient(header: header).platform, .ios)
        XCTAssertEqual(TranClientIdentity.current, header)
    }

    // MARK: - Signals

    private func response(_ status: Int, _ headers: [String: String] = [:]) -> HTTPURLResponse {
        HTTPURLResponse(
            url: URL(string: "http://127.0.0.1:3001")!, statusCode: status, httpVersion: nil,
            headerFields: headers)!
    }

    func testA426OrTheUpgradeCodeIsTheBlockingSignal() {
        XCTAssertEqual(TranStandingSignal.from(response(426), failure: nil), .upgradeRequired)
        let coded = TranRequestFailure(code: .clientUpgradeRequired, status: 400)
        XCTAssertEqual(TranStandingSignal.from(response(400), failure: coded), .upgradeRequired)
        XCTAssertEqual(errorCodeForHttpStatus(status: 426), .clientUpgradeRequired)
    }

    func testTheRecommendedHeadersAreTheNudge() {
        let nudge = [ApiContract.updateHeader: ApiContract.updateRecommended]
        XCTAssertEqual(TranStandingSignal.from(response(200, nudge), failure: nil), .updateRecommended(version: nil))
        let named = nudge.merging([ApiContract.recommendedVersionHeader: "1.5.0"]) { $1 }
        XCTAssertEqual(TranStandingSignal.from(response(204, named), failure: nil), .updateRecommended(version: "1.5.0"))
        XCTAssertNil(TranStandingSignal.from(response(200, [ApiContract.updateHeader: "later"]), failure: nil))
        XCTAssertNil(TranStandingSignal.from(response(200), failure: nil))
        XCTAssertNil(TranStandingSignal.from(response(500), failure: TranRequestFailure(code: .serverInternal)))
    }

    // MARK: - The blocking screen (REQ-VER-009)

    func testOnceRequiredTheScreenStaysAndNoPromptIsOffered() {
        let center = TranUpdateCenter(defaults: defaults)
        center.receive(.updateRecommended(version: "1.5.0"))
        XCTAssertNotNil(center.offer)
        center.receive(.upgradeRequired)
        XCTAssertTrue(center.required)
        XCTAssertNil(center.offer, "the screen replaces the prompt")
        center.receive(.updateRecommended(version: "1.6.0"))
        XCTAssertTrue(center.required, "a later nudge never lifts the screen")
        XCTAssertNil(center.offer)
    }

    func testTheUpgradeCodeIsAScreenThatIsNeverRetried() {
        let spec = errorSpec(code: .clientUpgradeRequired)
        XCTAssertEqual(spec.presentation, .screen)
        XCTAssertEqual(spec.httpStatus, 426)
        XCTAssertFalse(spec.retryable)
        XCTAssertEqual(TranFeedback.message(spec.messageKey), L10n.Errors.updateRequired)
        // A screen the app renders itself: no toast, no dialog.
        let feedback = TranFeedback()
        feedback.writer = { _ in }
        XCTAssertEqual(feedback.report(TranRequestFailure(code: .clientUpgradeRequired, status: 426)), .screen)
        XCTAssertNil(feedback.toast)
        XCTAssertNil(feedback.confirmation)
    }

    // MARK: - The prompt (REQ-VER-010)

    func testAPromptIsOfferedOncePerRecommendedVersion() throws {
        let center = TranUpdateCenter(defaults: defaults)
        center.receive(.updateRecommended(version: "1.5.0"))
        let offer = try XCTUnwrap(center.offer)
        XCTAssertEqual(offer.recommendedVersion, "1.5.0")
        center.receive(.updateRecommended(version: "1.5.0"))
        XCTAssertEqual(center.offer, offer, "the same offer, not a second one")

        center.dismiss(offer)
        XCTAssertNil(center.offer)
        XCTAssertEqual(defaults.string(forKey: TranUpdateCenter.dismissedKey), "1.5.0")

        // A later run remembers "Not now" for this version only.
        let later = TranUpdateCenter(defaults: defaults)
        later.receive(.updateRecommended(version: "1.5"))
        XCTAssertNil(later.offer, "the same version spelled shorter")
        later.receive(.updateRecommended(version: "1.6.0"))
        XCTAssertEqual(later.offer?.recommendedVersion, "1.6.0")
    }

    func testAnOfferIsNotRepeatedInOneRunEvenIfNotDismissed() throws {
        let center = TranUpdateCenter(defaults: defaults)
        center.receive(.updateRecommended(version: "1.5.0"))
        center.accept(try XCTUnwrap(center.offer))
        XCTAssertNil(center.offer)
        XCTAssertNil(defaults.string(forKey: TranUpdateCenter.dismissedKey), "Update is not a dismissal")
        center.receive(.updateRecommended(version: "1.5.0"))
        XCTAssertNil(center.offer, "one answer per version and run")
    }

    func testANudgeWithoutAVersionIsDismissedAsEmpty() throws {
        let center = TranUpdateCenter(defaults: defaults)
        center.receive(.updateRecommended(version: nil))
        center.dismiss(try XCTUnwrap(center.offer))
        XCTAssertEqual(defaults.string(forKey: TranUpdateCenter.dismissedKey), "")
        let later = TranUpdateCenter(defaults: defaults)
        later.receive(.updateRecommended(version: nil))
        XCTAssertNil(later.offer)
    }

    func testTheCatalogueDialogAsksUpdateOrNotNow() throws {
        let feedback = TranFeedback()
        var updated = false, declined = false
        feedback.confirm(.updateRecommended, perform: { updated = true }, onCancel: { declined = true })
        let pending = try XCTUnwrap(feedback.confirmation)
        XCTAssertEqual(pending.title, L10n.Shell.updateRecommended)
        XCTAssertEqual(pending.body, L10n.Shell.updateRecommendedBody)
        XCTAssertEqual(pending.confirmLabel, L10n.Common.update)
        XCTAssertEqual(pending.cancelLabel, L10n.Common.notNow)
        XCTAssertFalse(pending.destructive)
        pending.onCancel()
        XCTAssertTrue(declined)
        XCTAssertFalse(updated)
        pending.onConfirm()
        XCTAssertTrue(updated)
    }

    // MARK: - The store page (REQ-VER-011)

    func testTheStorePageComesFromTheBuildConfiguration() {
        // The app bundle carries `$(TRAN_IOS_STORE_URL)`, the placeholder in project.yml.
        XCTAssertEqual(TranStoreLink.url(bundle: .main), URL(string: "https://tran.example/ios")!)
        XCTAssertNotNil(Bundle.main.object(forInfoDictionaryKey: TranStoreLink.key))
        // No key at all (the unit-test bundle): the placeholder.
        XCTAssertEqual(TranStoreLink.url(bundle: Bundle(for: Self.self)), TranStoreLink.placeholder)
        XCTAssertEqual(TranStoreLink.placeholder.host, "tran.example")
    }
}
