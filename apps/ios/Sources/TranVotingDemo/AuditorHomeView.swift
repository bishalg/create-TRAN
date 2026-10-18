import SwiftUI

/// Auditor dashboard displaying the global voting rules matrix.
/// Verifies: REQ-NAV-004 REQ-NAV-005
struct AuditorHomeView: View {
    let useDark: Bool
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
        let background = useDark ? TranBrandTokens.Dark.background : TranBrandTokens.Light.background
        let textPrimary = useDark ? TranBrandTokens.Dark.textPrimary : TranBrandTokens.Light.textPrimary
        let primary = useDark ? TranBrandTokens.Dark.primary : TranBrandTokens.Light.primary

        ZStack {
            background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Election Auditor")
                                .font(.title2.weight(.bold))
                                .foregroundStyle(textPrimary)
                            Text("Global Rules & Parity Verification")
                                .font(.subheadline)
                                .foregroundStyle(textPrimary.opacity(0.8))
                        }
                        Spacer()
                        Button("Sign out", action: onSignOut)
                            .buttonStyle(.bordered)
                            .tint(primary)
                            .accessibilityIdentifier("sign-out-button")
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Verified Country Minimum Ages")
                            .font(.headline)
                            .foregroundStyle(textPrimary)

                        ForEach(countryRules, id: \.0) { item in
                            HStack {
                                Text(item.0)
                                    .fontWeight(.bold)
                                    .foregroundStyle(textPrimary)
                                Spacer()
                                Text("\(item.1) years")
                                    .foregroundStyle(textPrimary.opacity(0.9))
                            }
                            .padding(.vertical, 8)
                            Divider()
                        }
                    }
                    .padding(16)
                    .background(Color.white.opacity(0.06))
                    .cornerRadius(12)
                }
                .padding(20)
            }
        }
    }
}
