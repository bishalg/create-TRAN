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
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Election Auditor")
                                .font(.title2.weight(.bold))
                                .foregroundStyle(palette.textPrimary)
                            Text("Global Rules & Parity Verification")
                                .font(.subheadline)
                                .foregroundStyle(palette.textPrimary.opacity(0.8))
                        }
                        Spacer()
                        Button("Sign out", action: onSignOut)
                            .buttonStyle(.bordered)
                            .tint(palette.primary)
                            .accessibilityIdentifier("sign-out-button")
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Verified Country Minimum Ages")
                            .font(.headline)
                            .foregroundStyle(palette.textPrimary)

                        ForEach(countryRules, id: \.0) { item in
                            HStack {
                                Text(item.0)
                                    .fontWeight(.bold)
                                    .foregroundStyle(palette.textPrimary)
                                Spacer()
                                Text("\(item.1) years")
                                    .foregroundStyle(palette.textPrimary.opacity(0.9))
                            }
                            .padding(.vertical, 8)
                            Divider()
                        }
                    }
                    .padding(16)
                    .background(palette.surface.opacity(0.4))
                    .cornerRadius(12)
                }
                .padding(20)
            }
        }
    }
}
