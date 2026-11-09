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
    /// Names each option for UI tests: the control's own id plus the option, so a contract
    /// `select` step finds it (ADR-0038). `nil` leaves the segments unnamed.
    var identifier: String? = nil
    var optionName: (Value) -> String = { "\($0)" }

    var body: some View {
        TranInline(gap: .xxs) {
            ForEach(options, id: \.self) { option in
                segment(option)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityIdentifier(identifier ?? "")
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
        .accessibilityIdentifier(identifier.map { optionIdentifier($0, optionName(option)) } ?? "")
    }
}

/// `<control id>-<option>`: how a segmented control's option is addressed (the screen contract's
/// theme picker comment in `crates/rust-core/src/screens/catalogue.rs`).
func optionIdentifier(_ control: String, _ option: String) -> String {
    "\(control)-\(option)"
}
