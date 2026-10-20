import SwiftUI

/// Blocking choice (REQ-ERR-007) — the web `TranDialog` atom. A destructive confirm is styled as
/// such and Cancel stays the safe default; dismissing the alert counts as Cancel.
struct TranDialog: ViewModifier {
    @Binding var isPresented: Bool
    let title: String
    let message: String
    let confirmLabel: String
    let cancelLabel: String
    let destructive: Bool
    let onConfirm: () -> Void

    func body(content: Content) -> some View {
        content.alert(title, isPresented: $isPresented) {
            Button(cancelLabel, role: .cancel) {}
            Button(confirmLabel, role: destructive ? .destructive : nil, action: onConfirm)
        } message: {
            Text(message)
        }
    }
}
