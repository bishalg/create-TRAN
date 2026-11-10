import SwiftUI

enum TranButtonVariant: CaseIterable {
    case primary
    case secondary
    /// A destructive action, as the web `TranButton`'s `danger`: body-text colour on a fill tinted
    /// with the palette's danger colour and a danger outline, so contrast holds in every theme.
    case danger
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
    /// `.disabled(true)` dims the button as the web's `.tran-button:disabled` does (opacity 0.6),
    /// for an action that is already pending.
    @Environment(\.isEnabled) private var isEnabled

    let label: String
    var icon: String? = nil
    var variant: TranButtonVariant = .primary
    var size: TranButtonSize = .lg
    var fullWidth: Bool = false
    let action: () -> Void

    var body: some View {
        // The danger variant carries the destructive role too, for assistive technologies.
        Button(role: variant == .danger ? .destructive : nil, action: action) {
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
            .background {
                let shape = RoundedRectangle(cornerRadius: TranRadius.sm)
                ZStack {
                    shape.fill(background)
                    if variant == .danger {
                        // `color-mix(danger 16%, field)` and the `--tran-border-width` outline on the web.
                        shape.fill(palette.danger.opacity(0.16))
                        shape.strokeBorder(palette.danger, lineWidth: 1)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.6)
    }

    private var foreground: Color {
        switch variant {
        case .primary: return palette.onAction
        case .secondary, .danger: return palette.textPrimary
        }
    }

    private var background: Color {
        switch variant {
        case .primary: return palette.action
        case .secondary, .danger: return palette.surface
        }
    }
}
