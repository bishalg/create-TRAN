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
                // Oldest first, at most `toastPolicy().maxVisible`; a repeat restarts its timer
                // through `generation` instead of stacking (REQ-ERR-012).
                VStack(spacing: TranSpace.sm) {
                    ForEach(feedback.toasts) { toast in
                        TranToast(
                            tone: toast.tone,
                            message: toast.message,
                            reference: toast.reference,
                            dismissLabel: L10n.Common.dismiss,
                            onDismiss: { feedback.dismissToast(toast.id) }
                        )
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .task(id: "\(toast.id)-\(toast.generation)") {
                            // Toasts do not take focus, so announce them (REQ-ERR-008).
                            AccessibilityNotification.Announcement(toast.message).post()
                            try? await Task.sleep(nanoseconds: toast.durationMs * 1_000_000)
                            guard !Task.isCancelled else { return }
                            feedback.dismissToast(toast.id)
                        }
                    }
                }
                .padding(TranSpace.md)
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
                    cancelLabel: pending?.cancelLabel ?? L10n.Common.cancel,
                    destructive: pending?.destructive ?? false,
                    onConfirm: { pending?.onConfirm() },
                    onCancel: { pending?.onCancel() }
                )
            )
    }
}
