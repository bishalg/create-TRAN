// Verifies: REQ-PSH-013
import UserNotifications
import XCTest

/// A notification is a doorbell (ADR-0044): a tap opens what the navigation director resolves for
/// the stored session, and one arriving in the foreground is the catalogue's toast.
@MainActor
final class NotificationHandlingTests: XCTestCase {
    func testATapGoesWhereTheNavigationDirectorSendsTheStoredSession() {
        XCTAssertEqual(TranNotificationHandling.destination(for: .unauthenticated), .authWelcome, "signed out: Auth Welcome")
        XCTAssertEqual(TranNotificationHandling.destination(for: .authenticated(role: .citizenVoter)), .voterDashboard)
        XCTAssertEqual(TranNotificationHandling.destination(for: .authenticated(role: .electionAuditor)), .auditorDashboard)
        for session in [AuthSession.unauthenticated, .authenticated(role: .citizenVoter), .authenticated(role: .electionAuditor)] {
            XCTAssertEqual(TranNotificationHandling.destination(for: session), resolveDestinationOffline(role: session.role))
            XCTAssertEqual(TranNotificationHandling.destination(for: session), session.destination, "the screen the app shows")
        }
    }

    func testAForegroundNotificationIsTheCataloguesToast() {
        let feedback = TranFeedback()

        TranNotificationHandling.arrivedInForeground(feedback)

        let spec = actionSpec(action: .notificationReceived)
        guard case let .toast(tone, _) = spec.presentation else {
            return XCTFail("the catalogue presents a foreground notification as a toast")
        }
        XCTAssertEqual(feedback.toasts.count, 1)
        XCTAssertEqual(feedback.toast?.tone, tone)
        XCTAssertEqual(feedback.toast?.messageKey, "eligibility.notify.received")
        XCTAssertEqual(feedback.toast?.message, L10n.Eligibility.notifyReceived)
        XCTAssertNil(feedback.confirmation, "no dialog")
        XCTAssertNil(TranFeedback.dialogCopy(.notificationReceived))
    }

    func testTheGatewayHandsTapsAndForegroundNotificationsOnEvenWhenTheyCameFirst() {
        let gateway = FakePushGateway(available: true)
        gateway.deliver(.opened)
        var events: [TranPushEvent] = []

        gateway.onEvent = { events.append($0) }
        gateway.deliver(.arrivedInForeground)

        XCTAssertEqual(events, [.opened, .arrivedInForeground], "a tap that launched the app is not lost")
    }

    /// The system gateway asks iOS to present nothing in the foreground: the toast replaces the banner.
    func testTheSystemGatewayPresentsNoBannerInTheForeground() async throws {
        let gateway = SystemPushGateway(build: TranPushBuild(enabled: true, environment: "sandbox"))
        var events: [TranPushEvent] = []
        gateway.onEvent = { events.append($0) }
        let center = UNUserNotificationCenter.current()
        let content = UNMutableNotificationContent()
        let request = UNNotificationRequest(identifier: "doorbell", content: content, trigger: nil)
        // UNNotification has no public initialiser; its archived form is the documented way to make one.
        let archiver = NSKeyedArchiver(requiringSecureCoding: false)
        archiver.encode(request, forKey: "request")
        archiver.encode(Date(), forKey: "date")
        archiver.finishEncoding()
        let unarchiver = try NSKeyedUnarchiver(forReadingFrom: archiver.encodedData)
        unarchiver.requiresSecureCoding = false
        let notification = try XCTUnwrap(UNNotification(coder: unarchiver))

        let options = await gateway.userNotificationCenter(center, willPresent: notification)

        XCTAssertEqual(options, [])
        XCTAssertEqual(events, [.arrivedInForeground])
    }
}
