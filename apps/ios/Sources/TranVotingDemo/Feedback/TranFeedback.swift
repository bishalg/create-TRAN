// Verifies: REQ-ERR-006 REQ-ERR-007 REQ-ERR-008 REQ-ERR-010 REQ-ERR-012 REQ-ERR-014
import Foundation
import Observation
import os

/// The iOS implementation of the Rust feedback policy (ADR-0028, ADR-0036). Screens say *what*
/// happened; the catalogue decides *how* the user hears about it. `TranFeedbackHost` renders it.
@MainActor
@Observable
final class TranFeedback {
    /// A self-dismissing, non-blocking message.
    struct Toast: Equatable, Identifiable {
        let id = UUID()
        /// Bumped when the same toast arrives again, so its timer restarts (REQ-ERR-012).
        var generation = 0
        let tone: TranToastTone
        let messageKey: String
        let message: String
        var reference: String?
        var durationMs: UInt64
    }

    /// A blocking choice waiting for the user.
    struct Confirmation: Identifiable {
        let id = UUID()
        let title: String
        let body: String
        let confirmLabel: String
        var cancelLabel: String = L10n.Common.cancel
        let destructive: Bool
        let onConfirm: () -> Void
    }

    /// Oldest first; at most `toastPolicy().maxVisible` (REQ-ERR-012).
    private(set) var toasts: [Toast] = []
    var confirmation: Confirmation?
    /// What runs when the user confirms the dialog a failure opened (REQ-ERR-010).
    @ObservationIgnored private var errorHandlers: [TranErrorCode: () -> Void] = [:]

    /// The newest toast, if any.
    var toast: Toast? { toasts.last }

    private static let logger = Logger(subsystem: "com.tran.voting", category: "feedback")

    /// Shows an action's acknowledgement when the catalogue makes it a toast (REQ-ERR-008).
    func acknowledge(_ action: TranUserAction) {
        let spec = actionSpec(action: action)
        show(spec.presentation, messageKey: spec.messageKey, requestId: nil)
    }

    /// Runs `perform` once the user agrees — immediately when the catalogue asks for no dialog
    /// (REQ-ERR-007).
    func confirm(_ action: TranUserAction, perform: @escaping () -> Void) {
        let spec = actionSpec(action: action)
        guard case let .dialog(destructive) = spec.presentation, let copy = Self.dialogCopy(action)
        else {
            perform()
            return
        }
        confirmation = Confirmation(
            title: Self.message(spec.messageKey),
            body: copy.body,
            confirmLabel: copy.confirm,
            destructive: destructive,
            onConfirm: perform
        )
    }

    /// Runs `perform` when the user confirms the dialog a failure with `code` opens — "Sign in
    /// again" for `auth.session_expired` (REQ-ERR-010). One handler per code; the latest wins.
    func onErrorConfirmed(_ code: TranErrorCode, perform: @escaping () -> Void) {
        errorHandlers[code] = perform
    }

    /// Logs the failure and shows it when it is a toast or a dialog. Returns the presentation so
    /// the screen can render inline and banner states, which it owns (REQ-ERR-006).
    @discardableResult
    func report(_ failure: TranRequestFailure) -> TranPresentation {
        log(failure)
        let spec = failure.spec
        show(spec.presentation, messageKey: spec.messageKey, requestId: failure.requestId)
        if case let .dialog(destructive) = spec.presentation, let copy = Self.errorDialogCopy(failure.code) {
            let code = failure.code
            confirmation = Confirmation(
                title: Self.message(spec.messageKey),
                body: copy.body,
                confirmLabel: copy.confirm,
                cancelLabel: copy.cancel,
                destructive: destructive,
                onConfirm: { [weak self] in self?.errorHandlers[code]?() }
            )
        }
        return spec.presentation
    }

    /// The one `request failed` event with `LOG_EVENT`'s fields (`fixtures/feedback.json`), as
    /// logfmt; `-` marks a field the failure does not have (REQ-ROB-007).
    nonisolated static func logLine(_ failure: TranRequestFailure) -> String {
        let status = failure.status.map(String.init) ?? "-"
        return "request failed code=\(failure.spec.wireCode) status=\(status) request_id=\(failure.requestId ?? "-")"
    }

    /// Logs at the catalogue level — for background calls the user did not start — and hands
    /// `error`-level failures to the reporter (REQ-ERR-014).
    func log(_ failure: TranRequestFailure) {
        let message = Self.logLine(failure)
        switch failure.spec.logLevel {
        case .debug: Self.logger.debug("\(message, privacy: .public)")
        case .info: Self.logger.info("\(message, privacy: .public)")
        case .warn: Self.logger.warning("\(message, privacy: .public)")
        case .error: Self.logger.error("\(message, privacy: .public)")
        }
        TranReporting.report(failure)
    }

    /// Dismisses the toast with `id`, or the newest one.
    func dismissToast(_ id: UUID? = nil) {
        guard let id = id ?? toasts.last?.id else { return }
        toasts.removeAll { $0.id == id }
    }

    /// Localized copy for a catalogue key; `codegen` guarantees every key exists.
    nonisolated static func message(_ key: String) -> String {
        L10n.feedback(key) ?? L10n.Errors.unexpected
    }

    /// Body and confirm label per action; the title is the catalogue's `messageKey`. Exhaustive,
    /// so a new action from Rust fails to compile until it has copy.
    nonisolated static func dialogCopy(_ action: TranUserAction) -> (body: String, confirm: String)? {
        switch action {
        case .signOut: return (L10n.Auth.signOutConfirmBody, L10n.Common.signOut)
        case .serverCheckSucceeded: return nil
        }
    }

    /// Dialog copy for failures the catalogue presents as a dialog; a parity test keeps it complete.
    nonisolated static func errorDialogCopy(
        _ code: TranErrorCode
    ) -> (body: String, confirm: String, cancel: String)? {
        switch code {
        case .authSessionExpired:
            return (L10n.Errors.sessionExpiredBody, L10n.Auth.signInAgain, L10n.Common.notNow)
        default:
            return nil
        }
    }

    private func show(_ presentation: TranPresentation, messageKey: String, requestId: String?) {
        guard case let .toast(tone, duration) = presentation else { return }
        let reference = requestId.map { L10n.Errors.reference($0) }
        let durationMs = toastDurationMs(duration: duration)
        let visible = toasts.map { TranToastKey(messageKey: $0.messageKey, tone: $0.tone) }
        switch admitToast(visible: visible, incoming: TranToastKey(messageKey: messageKey, tone: tone)) {
        case let .refresh(index):
            let i = Int(index)
            toasts[i].generation += 1
            toasts[i].reference = reference
            toasts[i].durationMs = durationMs
        case let .append(evictOldest):
            toasts.removeFirst(min(Int(evictOldest), toasts.count))
            toasts.append(
                Toast(
                    tone: tone,
                    messageKey: messageKey,
                    message: Self.message(messageKey),
                    reference: reference,
                    durationMs: durationMs
                )
            )
        }
    }
}
