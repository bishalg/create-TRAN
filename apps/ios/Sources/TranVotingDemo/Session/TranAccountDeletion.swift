// Verifies: REQ-ACC-005 REQ-ACC-006 REQ-ROB-007
import Foundation
import Observation

/// The app's half of account deletion (spec 024, ADR-0041). The catalogue's dialog asks first
/// (REQ-ACC-005); confirming calls the server, and only its answer moves the app: a deletion
/// leaves for Auth Welcome with the success toast, a failure stays on the screen and is presented
/// by the catalogue, with the screen's own part (the offline banner) handed back (REQ-ACC-006).
/// One per app, owned by the coordinator; the "Delete account" control reads `inFlight` from the
/// environment and stays disabled until the server answers.
@MainActor
@Observable
final class TranAccountDeletion {
    /// What a signed-in screen calls from its "Delete account" control: it passes how to show the
    /// presentations it owns (a banner), the coordinator does the rest.
    typealias Request = (_ onFailed: @escaping @MainActor (TranRequestFailure) -> Void) -> Void

    /// From the confirmation until the server's answer: no second deletion starts (REQ-ACC-006).
    private(set) var inFlight = false

    /// Opens the confirmation; nothing reaches the server until the user confirms. Ignored while a
    /// deletion is in flight.
    func confirm(
        client: TranSessionClient,
        feedback: TranFeedback,
        onDeleted: @escaping @MainActor () -> Void,
        onFailed: @escaping @MainActor (TranRequestFailure) -> Void
    ) {
        guard !inFlight else { return }
        feedback.confirm(.deleteAccount) { [weak self] in
            guard let self, !self.inFlight else { return }
            self.inFlight = true
            Task { @MainActor in
                await self.run(client: client, feedback: feedback, onDeleted: onDeleted, onFailed: onFailed)
            }
        }
    }

    /// Deletes on the server, then follows its answer. The client has already logged a failed
    /// request, so the failure is presented without a second `request failed` event (REQ-ROB-007).
    private func run(
        client: TranSessionClient,
        feedback: TranFeedback,
        onDeleted: @MainActor () -> Void,
        onFailed: @MainActor (TranRequestFailure) -> Void
    ) async {
        defer { inFlight = false }
        do {
            try await client.deleteAccount()
            onDeleted()
            feedback.acknowledge(.accountDeleted)
        } catch {
            // `401` has already been through the recovery table: its dialog asks to sign in again.
            let failure = TranRequestFailure.classify(error)
            feedback.present(failure)
            onFailed(failure)
        }
    }
}
