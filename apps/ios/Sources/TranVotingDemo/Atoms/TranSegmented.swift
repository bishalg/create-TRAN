import SwiftUI

/// Single-choice segmented control. The system segmented picker keeps its own ~32 pt height on
/// older SDKs, so TRAN owns the control instead: every segment is a button of at least
/// `TranSpace.touch` (44 pt) carrying the selected trait (REQ-NAT-003, REQ-NAT-005). Labels come
/// from the caller, so copy still comes from the shared dictionaries (REQ-NAT-008).
struct TranSegmented<Value: Hashable>: View {
    @Environment(\.tranPalette) private var palette

    let options: [Value]
    @Binding var selection: Value
    let label: (Value) -> String
    var accessibilityLabel: String = ""

    var body: some View {
        TranInline(gap: .xxs) {
            ForEach(options, id: \.self) { option in
                segment(option)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityLabel)
    }

    private func segment(_ option: Value) -> some View {
        let selected = option == selection
        return Button {
            selection = option
        } label: {
            Text(label(option))
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? palette.onAction : palette.textPrimary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: TranSpace.touch)
                .background(selected ? palette.action : palette.surface)
                .clipShape(RoundedRectangle(cornerRadius: TranRadius.sm))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}
