// Verifies: REQ-SEC-021
import Foundation

/// The background half of launch (REQ-SEC-021): the Splash has already routed from the vault;
/// this asks the server and acts on `sessionRecovery`. A dead credential opens the existing
/// `auth.session_expired` dialog (REQ-ERR-010); anything else changes nothing on screen.
@MainActor
enum TranSessionRestore {
    @discardableResult
    static func validate(
        _ client: TranSessionClient, feedback: TranFeedback
    ) async -> TranSessionClient.Validation {
        let outcome = await client.validate()
        if outcome == .signedOut { feedback.report(TranSessionClient.expired) }
        return outcome
    }
}

/// Whether the privacy cover hides the window (REQ-SEC-023): whenever the scene is not active
/// while a signed-in screen is on display, so the app switcher shows no user data.
enum TranPrivacyCover {
    static func covers(sceneIsActive: Bool, destination: TranAppDestination) -> Bool {
        guard !sceneIsActive else { return false }
        switch destination {
        case .voterDashboard, .auditorDashboard: return true
        case .splash, .authWelcome: return false
        }
    }
}
