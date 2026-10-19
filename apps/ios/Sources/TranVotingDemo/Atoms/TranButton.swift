import SwiftUI

enum TranButtonVariant: CaseIterable {
    case primary
    case secondary
}

enum TranButtonSize: CaseIterable {
    case md
    case lg

    var horizontalPadding: CGFloat {
        switch self {
        case .md: return TranSpace.md
        case .lg: return TranSpace.lg
        }
    }
}

/// Token-sized action button. The minimum target is `TranSpace.touch` (44 pt) for every size
/// and variant (REQ-NAT-005); colours come from the palette, never from literals (REQ-NAT-009).
struct TranButton: View {
    @Environment(\.tranPalette) private var palette

    let label: String
    var icon: String? = nil
    var variant: TranButtonVariant = .primary
    var size: TranButtonSize = .lg
    var fullWidth: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            TranInline(gap: .sm) {
                if let icon {
                    Image(systemName: icon)
                }
                Text(label).font(.body.weight(.semibold))
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, size.horizontalPadding)
            .padding(.vertical, TranSpace.sm)
            .frame(minHeight: TranSpace.touch)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(background, in: RoundedRectangle(cornerRadius: TranRadius.sm))
        }
        .buttonStyle(.plain)
    }

    private var foreground: Color {
        switch variant {
        case .primary: return palette.onAction
        case .secondary: return palette.textPrimary
        }
    }

    private var background: Color {
        switch variant {
        case .primary: return palette.action
        case .secondary: return palette.surface
        }
    }
}
