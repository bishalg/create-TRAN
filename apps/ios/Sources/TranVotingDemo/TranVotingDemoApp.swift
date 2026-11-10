import SwiftUI

@main
struct TranVotingDemoApp: App {
    /// UIKit's launch and APNs callbacks, forwarded to the push gateway (`Push/SystemPushGateway.swift`).
    @UIApplicationDelegateAdaptor(TranAppDelegate.self) private var appDelegate

    init() {
        // Before any screen runs: uncaught exceptions are reported, then end the app (REQ-ERR-011).
        TranReporting.installUncaughtExceptionHandler()
    }

    var body: some Scene {
        WindowGroup {
            NavigationCoordinatorView()
        }
    }
}
