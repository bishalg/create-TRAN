import SwiftUI

/// Welcome and role-selection screen providing the two branching navigation options.
/// Verifies: REQ-NAV-002 REQ-NAV-003 REQ-NAV-004
struct AuthWelcomeView: View {
    let useDark: Bool
    let onSelectRole: (UserRole) -> Void

    var body: some View {
        let background = useDark ? TranBrandTokens.Dark.background : TranBrandTokens.Light.background
        let textPrimary = useDark ? TranBrandTokens.Dark.textPrimary : TranBrandTokens.Light.textPrimary
        let primary = useDark ? TranBrandTokens.Dark.primary : TranBrandTokens.Light.primary

        ZStack {
            background.ignoresSafeArea()
            VStack(spacing: 28) {
                VStack(spacing: 8) {
                    Text("TRAN Voting")
                        .font(.largeTitle.weight(.bold))
                        .foregroundStyle(textPrimary)
                    Text("Choose your access role to continue:")
                        .font(.body)
                        .foregroundStyle(textPrimary.opacity(0.8))
                }

                VStack(spacing: 16) {
                    Button(action: { onSelectRole(.citizenVoter) }) {
                        HStack {
                            Image(systemName: "person.fill")
                            Text("Continue as Citizen Voter")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(primary)
                    .accessibilityIdentifier("voter-branch-button")

                    Button(action: { onSelectRole(.electionAuditor) }) {
                        HStack {
                            Image(systemName: "checkmark.shield.fill")
                            Text("Continue as Election Auditor")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.bordered)
                    .tint(primary)
                    .accessibilityIdentifier("auditor-branch-button")
                }
            }
            .padding(24)
        }
    }
}
