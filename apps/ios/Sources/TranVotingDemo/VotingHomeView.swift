import SwiftUI

/// Placeholder voting demo — consumes generated brand tokens from rust-core.
struct VotingHomeView: View {
    @State private var useDark = true

    var body: some View {
        let background = useDark ? TranBrandTokens.Dark.background : TranBrandTokens.Light.background
        let textPrimary = useDark ? TranBrandTokens.Dark.textPrimary : TranBrandTokens.Light.textPrimary
        let canVote = useDark ? TranBrandTokens.Dark.eligibilityCanVote : TranBrandTokens.Light.eligibilityCanVote
        let cannotVote = useDark ? TranBrandTokens.Dark.eligibilityCannotVote : TranBrandTokens.Light.eligibilityCannotVote
        let primary = useDark ? TranBrandTokens.Dark.primary : TranBrandTokens.Light.primary

        ZStack {
            background.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text("TRAN / iOS")
                    .font(.headline)
                    .foregroundStyle(textPrimary)
                Text("Voting eligibility (native scaffold)")
                    .font(.subheadline)
                    .foregroundStyle(textPrimary.opacity(0.8))
                HStack(spacing: 12) {
                    eligibilityChip(title: "Eligible", color: canVote)
                    eligibilityChip(title: "Not eligible", color: cannotVote)
                }
                Toggle("Dark theme", isOn: $useDark)
                    .tint(primary)
            }
            .padding(24)
        }
    }

    private func eligibilityChip(title: String, color: Color) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(color.opacity(0.2))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}
