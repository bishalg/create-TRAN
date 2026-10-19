import SwiftUI

/// Labelled text input (web `Field`). `hint` is the field placeholder; the label styles and the
/// input box come from tokens. `identifier` lands on the control itself so UI tests keep querying
/// `textFields["age-field"]`.
struct TranField: View {
    @Environment(\.tranPalette) private var palette

    let label: String
    var hint: String? = nil
    @Binding var text: String
    var identifier: String = ""
    var keyboard: UIKeyboardType = .default
    var autocapitalization: TextInputAutocapitalization? = nil

    var body: some View {
        TranStack(gap: .xs, alignment: .leading) {
            TranText(label)
            TextField("", text: $text, prompt: Text(hint ?? "").foregroundStyle(palette.textPrimary))
                .keyboardType(keyboard)
                .textInputAutocapitalization(autocapitalization)
                .padding(TranSpace.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(palette.surface)
                .foregroundStyle(palette.textPrimary)
                .clipShape(RoundedRectangle(cornerRadius: TranRadius.sm))
                .accessibilityLabel(label)
                .accessibilityIdentifier(identifier)
        }
    }
}
