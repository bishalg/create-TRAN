// Verifies: REQ-PSH-013
import Foundation

/// What a notification does to the app (REQ-PSH-013). A notification is a doorbell (ADR-0044): it
/// names no screen. A tap goes where the Rust navigation director sends the stored session
/// (`resolveDestinationOffline`), so a signed-out device lands on Auth Welcome; one that arrives in
/// the foreground is the catalogue's `notificationReceived` toast, never a system banner over the
/// app (the gateway asks iOS to present nothing).
@MainActor
enum TranNotificationHandling {
    /// The screen a tap on a notification opens, for the session the device holds.
    static func destination(for session: AuthSession) -> TranAppDestination {
        resolveDestinationOffline(role: session.role)
    }

    /// The foreground notification, in the catalogue's words and presentation.
    static func arrivedInForeground(_ feedback: TranFeedback) {
        feedback.acknowledge(.notificationReceived)
    }
}
