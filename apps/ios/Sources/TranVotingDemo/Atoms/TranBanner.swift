import SwiftUI

/// Persistent, non-blocking notice for a condition that is still true — the API is unreachable —
/// removed by its owner when the condition clears (REQ-ERR-006). Never auto-dismisses.
struct TranBanner: View {
    @Environment(\.tranPalette) private var palette

    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TranSpace.sm) {
            Image(systemName: "wifi.exclamationmark")
                .foregroundStyle(palette.accent)
                .accessibilityHidden(true)
            Text(message)
                .font(.callout)
                .foregroundStyle(palette.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(TranSpace.base)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: TranRadius.sm))
        .overlay(
            RoundedRectangle(cornerRadius: TranRadius.sm).stroke(palette.accent, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
