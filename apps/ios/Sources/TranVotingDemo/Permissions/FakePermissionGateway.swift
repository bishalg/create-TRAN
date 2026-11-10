#if DEBUG
    // Verifies: REQ-PRV-003 REQ-PRV-007
    import CoreLocation
    import Foundation

    /// A permission gateway with no operating system behind it: the unit tests script it, and the
    /// debug launch presets use it so a UI test can never meet a real system prompt
    /// (`TranPermissionLaunch`). It records every request, so a test can prove none came before a
    /// tap and the priming (REQ-PRV-003). Compiled into debug builds only.
    @MainActor
    final class FakePermissionGateway: PermissionGateway {
        /// The status each permission reports; `not_determined` when unset.
        var statuses: [TranPermissionId: TranPermissionStatus]
        /// What the "system prompt" answers; a refusal unless a test says otherwise.
        var answer: TranPermissionStatus = .deniedPermanently
        /// The reading `oneApproximateFix` delivers once permission is granted.
        var fix: CLLocation?

        private(set) var requests: [TranPermissionId] = []
        private(set) var fixesRequested = 0
        private(set) var settingsOpened = 0

        init(_ statuses: [TranPermissionId: TranPermissionStatus] = [:]) {
            self.statuses = statuses
        }

        func status(of permission: TranPermissionId) -> TranPermissionStatus {
            statuses[permission] ?? .notDetermined
        }

        func request(_ permission: TranPermissionId) async -> TranPermissionStatus {
            requests.append(permission)
            // Like iOS: only an unanswered permission shows the prompt.
            if status(of: permission) == .notDetermined { statuses[permission] = answer }
            return status(of: permission)
        }

        func oneApproximateFix() async -> CLLocation? {
            fixesRequested += 1
            switch status(of: .locationApproximate) {
            case .granted, .grantedApproximate: return fix
            default: return nil
            }
        }

        func openSettings() {
            settingsOpened += 1
        }
    }
#endif
