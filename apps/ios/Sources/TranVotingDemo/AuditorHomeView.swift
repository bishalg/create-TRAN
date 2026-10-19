import SwiftUI

/// Auditor dashboard displaying the global voting rules matrix.
/// Verifies: REQ-NAV-004 REQ-NAV-005
struct AuditorHomeView: View {
    let palette: TranPalette
    let onSignOut: () -> Void

    private let countryRules: [(String, Int)] = [
        ("BR", 16),
        ("NP", 18),
        ("US", 18),
        ("IN", 18),
        ("DE", 18),
        ("FR", 18),
        ("GB", 18)
    ]

    var body: some View {
        ZStack {
            palette.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: TranSpace.lg) {
                    HStack {
                        VStack(alignment: .leading, spacing: TranSpace.xs) {
                            Text(L10n.Common.roleElectionAuditor)
                                .font(.title2.weight(.bold))
                                .foregroundStyle(palette.textPrimary)
                            Text(L10n.Auditor.subtitle)
                                .font(.subheadline)
                                .foregroundStyle(palette.textPrimary.opacity(0.8))
                        }
                        Spacer()
                        Button(action: onSignOut) {
                            Text(L10n.Common.signOut)
                                .foregroundStyle(palette.textPrimary)
                        }
                        .buttonStyle(.bordered)
                        .tint(palette.primary)
                        .accessibilityIdentifier("sign-out-button")
                    }

                    VStack(alignment: .leading, spacing: TranSpace.base) {
                        Text(L10n.Auditor.rulesTitle)
                            .font(.headline)
                            .foregroundStyle(palette.textPrimary)

                        ForEach(countryRules, id: \.0) { item in
                            HStack {
                                Text(item.0)
                                    .fontWeight(.bold)
                                    .foregroundStyle(palette.textPrimary)
                                Spacer()
                                Text(L10n.Auditor.years(String(item.1)))
                                    .foregroundStyle(palette.textPrimary.opacity(0.9))
                            }
                            .padding(.vertical, 8)
                            Divider()
                        }
                    }
                    .padding(TranSpace.md)
                    .background(palette.surface.opacity(0.4))
                    .cornerRadius(TranRadius.md)
                }
                .padding(TranSpace.lg)
            }
        }
    }
}
