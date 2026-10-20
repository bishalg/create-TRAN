import SwiftUI

/// Non-blocking, self-dismissing message (REQ-ERR-006) — the web `TranToast` atom. The owner
/// times it out with the catalogue duration; the dismiss button is a 44 pt target (REQ-NAT-005).
struct TranToast: View {
    @Environment(\.tranPalette) private var palette

    let tone: TranToastTone
    let message: String
    var reference: String? = nil
    let dismissLabel: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TranSpace.sm) {
            Image(systemName: icon)
                .foregroundStyle(toneColor)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TranSpace.xxs) {
                Text(message).font(.body.weight(.semibold))
                if let reference {
                    Text(reference).font(.caption)
                }
            }
            .foregroundStyle(palette.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .foregroundStyle(palette.textPrimary)
                    .frame(minWidth: TranSpace.touch, minHeight: TranSpace.touch)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(dismissLabel)
            .accessibilityIdentifier("toast-dismiss")
        }
        .padding(.leading, TranSpace.md)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: TranRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TranRadius.md).stroke(toneColor, lineWidth: TranSpace.xxs)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("toast")
    }

    private var icon: String {
        switch tone {
        case .success: return "checkmark.circle.fill"
        case .info: return "info.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "xmark.octagon.fill"
        }
    }

    private var toneColor: Color {
        switch tone {
        case .success: return palette.success
        case .info: return palette.primary
        case .warning: return palette.accent
        case .error: return palette.danger
        }
    }
}
