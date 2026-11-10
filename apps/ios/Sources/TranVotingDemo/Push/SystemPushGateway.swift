// Verifies: REQ-PSH-012 REQ-PSH-013
import os
import UIKit
import UserNotifications

/// The one type that registers with APNs and receives what the notification center reports
/// (REQ-PSH-012): `push-guards.test.ts` fails when any other source file calls the registration
/// API, implements its callbacks or is the center's delegate. The notification permission is asked
/// by `Permissions/SystemPermissionGateway`. With `TRAN_PUSH_ENABLED` off (the default) the build
/// has no `aps-environment` entitlement, this reports push unavailable and asks iOS for nothing.
@MainActor
final class SystemPushGateway: NSObject, PushGateway {
    static let shared = SystemPushGateway(build: .current)

    let isAvailable: Bool
    private(set) var token: String?
    var onEvent: ((TranPushEvent) -> Void)? {
        didSet { flush() }
    }

    private var requested = false
    private var pending: [TranPushEvent] = []
    private nonisolated static let logger = Logger(subsystem: "com.tran.voting", category: "push")

    init(build: TranPushBuild) {
        isAvailable = build.enabled
    }

    /// At launch, before it finishes, so a tap that launched the app reaches the delegate.
    func attach() {
        guard isAvailable else { return }
        UNUserNotificationCenter.current().delegate = self
    }

    func registerForPush() {
        // Once per process: iOS answers every launch's request with the current token.
        guard isAvailable, !requested else { return }
        requested = true
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// The token as the API takes it: lowercase hex (`docs/API.md`).
    nonisolated static func hex(_ deviceToken: Data) -> String {
        deviceToken.map { String(format: "%02x", $0) }.joined()
    }

    fileprivate func registered(_ deviceToken: Data) {
        token = Self.hex(deviceToken)
        emit(.tokenArrived)
    }

    fileprivate func failedToRegister() {
        // No token, so nothing to sync; the error says nothing a person can act on. A fixed
        // message only: the error is never logged (REQ-PSH-007 holds on the device too).
        requested = false
        let message = "push registration failed"
        Self.logger.warning("\(message, privacy: .public)")
    }

    private func emit(_ event: TranPushEvent) {
        pending.append(event)
        flush()
    }

    private func flush() {
        guard let onEvent else { return }
        let events = pending
        pending = []
        events.forEach(onEvent)
    }
}

extension SystemPushGateway: UNUserNotificationCenterDelegate {
    /// In the foreground the app shows the catalogue's toast instead of a system banner
    /// (REQ-PSH-013).
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        await MainActor.run { emit(.arrivedInForeground) }
        return []
    }

    /// A tap: the app routes through the navigation director, never to a screen the payload names.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        await MainActor.run { emit(.opened) }
    }
}

/// The application delegate SwiftUI forwards UIKit's launch and APNs callbacks to. It lives here
/// because those callbacks are push registration (REQ-PSH-012).
final class TranAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        (TranPushLaunch.shared as? SystemPushGateway)?.attach()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        SystemPushGateway.shared.registered(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        SystemPushGateway.shared.failedToRegister()
    }
}
