import SwiftUI

/// Welcome and role-selection screen providing the two branching navigation options.
/// Verifies: REQ-NAV-002 REQ-NAV-003 REQ-NAV-004
struct AuthWelcomeView: View {
    let palette: TranPalette
    let onSelectRole: (UserRole) -> Void

    var body: some View {
        ZStack {
            palette.background.ignoresSafeArea()
            VStack(spacing: 28) {
                VStack(spacing: 8) {
                    Text(L10n.Auth.welcomeTitle)
                        .font(.largeTitle.weight(.bold))
                        .foregroundStyle(palette.textPrimary)
                    Text(L10n.Auth.welcomeSubtitle)
                        .font(.body)
                        .foregroundStyle(palette.textPrimary.opacity(0.8))
                }

                VStack(spacing: 16) {
                    Button(action: { onSelectRole(.citizenVoter) }) {
                        HStack {
                            Image(systemName: "person.fill")
                            Text(L10n.Auth.continueAsVoter)
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(palette.primary)
                    .accessibilityIdentifier("voter-branch-button")

                    Button(action: { onSelectRole(.electionAuditor) }) {
                        HStack {
                            Image(systemName: "checkmark.shield.fill")
                            Text(L10n.Auth.continueAsAuditor)
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.bordered)
                    .tint(palette.primary)
                    .accessibilityIdentifier("auditor-branch-button")
                }
            }
            .padding(24)
        }
    }
}
