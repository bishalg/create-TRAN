import SwiftUI

/// Welcome and role-selection screen providing the two branching navigation options.
/// Verifies: REQ-NAV-002 REQ-NAV-003 REQ-NAV-004
struct AuthWelcomeView: View {
    let onSelectRole: (UserRole) -> Void

    var body: some View {
        TranScreen {
            TranBox(padding: .lg) {
                TranStack(gap: .lg) {
                    TranStack(gap: .sm) {
                        TranText(L10n.Auth.welcomeTitle, variant: .display)
                        TranText(L10n.Auth.welcomeSubtitle, variant: .muted)
                    }

                    TranStack(gap: .md) {
                        TranButton(
                            label: L10n.Auth.continueAsVoter,
                            icon: "person.fill",
                            fullWidth: true
                        ) {
                            onSelectRole(.citizenVoter)
                        }
                        .accessibilityIdentifier("voter-branch-button")

                        TranButton(
                            label: L10n.Auth.continueAsAuditor,
                            icon: "checkmark.shield.fill",
                            variant: .secondary,
                            fullWidth: true
                        ) {
                            onSelectRole(.electionAuditor)
                        }
                        .accessibilityIdentifier("auditor-branch-button")
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}
