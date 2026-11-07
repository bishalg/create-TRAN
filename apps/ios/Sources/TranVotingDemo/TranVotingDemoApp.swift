import SwiftUI

@main
struct TranVotingDemoApp: App {
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
