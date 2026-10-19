import SwiftUI

/// Typography and tone variants — the same vocabulary as the web `TranText` atom.
enum TranTextVariant: CaseIterable {
    case display
    case title
    case body
    case caption
    case muted
    case success
    case danger
}

/// Token-bound typography atom. Sizes are semantic system styles so Dynamic Type keeps working
/// (REQ-NAT-004); colours come from the palette in the environment. `live` marks a region whose
/// changes are announced (REQ-NAT-003).
struct TranText: View {
    @Environment(\.tranPalette) private var palette

    private let text: String
    private let variant: TranTextVariant
    private let live: Bool
    private let bold: Bool

    init(_ text: String, variant: TranTextVariant = .body, live: Bool = false, bold: Bool = false) {
        self.text = text
        self.variant = variant
        self.live = live
        self.bold = bold
    }

    var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(live ? [.updatesFrequently] : [])
    }

    private var font: Font {
        let base: Font
        switch variant {
        case .display: base = .largeTitle
        case .title: base = .title2
        case .caption: base = .caption
        default: base = .body
        }
        switch variant {
        case .display, .title: return base.weight(.bold)
        default: return bold ? base.weight(.bold) : base
        }
    }

    private var color: Color {
        switch variant {
        case .muted: return palette.textPrimary.opacity(0.8)
        case .success: return palette.success
        case .danger: return palette.danger
        default: return palette.textPrimary
        }
    }
}
