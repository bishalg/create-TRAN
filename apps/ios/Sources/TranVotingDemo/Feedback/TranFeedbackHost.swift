import SwiftUI

/// Renders `TranFeedback` over the whole app: the toast at the bottom, timed by the catalogue,
/// and the pending confirmation as a dialog. Composes atoms only.
struct TranFeedbackHost: ViewModifier {
    @Bindable var feedback: TranFeedback

    func body(content: Content) -> some View {
        // Captured per render: the alert may clear the binding before it runs the action.
        let pending = feedback.confirmation
        return content
            .overlay(alignment: .bottom) {
                if let toast = feedback.toast {
                    TranToast(
                        tone: toast.tone,
                        message: toast.message,
                        reference: toast.reference,
                        dismissLabel: L10n.Common.dismiss,
                        onDismiss: feedback.dismissToast
                    )
                    .padding(TranSpace.md)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: toast.id) {
                        // Toasts do not take focus, so announce them (REQ-ERR-008).
                        AccessibilityNotification.Announcement(toast.message).post()
                        try? await Task.sleep(nanoseconds: toast.durationMs * 1_000_000)
                        if feedback.toast?.id == toast.id { feedback.dismissToast() }
                    }
                }
            }
            .modifier(
                TranDialog(
                    isPresented: Binding(
                        get: { pending != nil },
                        set: { if !$0 { feedback.confirmation = nil } }
                    ),
                    title: pending?.title ?? "",
                    message: pending?.body ?? "",
                    confirmLabel: pending?.confirmLabel ?? "",
                    cancelLabel: L10n.Common.cancel,
                    destructive: pending?.destructive ?? false,
                    onConfirm: { pending?.onConfirm() }
                )
            )
    }
}
