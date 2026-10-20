// Verifies: REQ-ERR-006 REQ-ERR-007 REQ-ERR-008
import Foundation
import Observation
import os

/// The iOS implementation of the Rust feedback policy (ADR-0028). Screens say *what* happened;
/// the catalogue decides *how* the user hears about it. `TranFeedbackHost` renders the state.
@MainActor
@Observable
final class TranFeedback {
    /// A self-dismissing, non-blocking message.
    struct Toast: Equatable, Identifiable {
        let id = UUID()
        let tone: TranToastTone
        let message: String
        let reference: String?
        let durationMs: UInt64
    }

    /// A blocking choice waiting for the user.
    struct Confirmation: Identifiable {
        let id = UUID()
        let title: String
        let body: String
        let confirmLabel: String
        let destructive: Bool
        let onConfirm: () -> Void
    }

    private(set) var toast: Toast?
    var confirmation: Confirmation?

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

    /// Logs the failure and shows it when it is a toast. Returns the presentation so the screen
    /// can render inline and banner states, which it owns (REQ-ERR-006).
    @discardableResult
    func report(_ failure: TranRequestFailure) -> TranPresentation {
        log(failure)
        let spec = failure.spec
        show(spec.presentation, messageKey: spec.messageKey, requestId: failure.requestId)
        return spec.presentation
    }

    /// The one `request failed` event with `LOG_EVENT`'s fields (`fixtures/feedback.json`), as
    /// logfmt; `-` marks a field the failure does not have (REQ-ROB-007).
    nonisolated static func logLine(_ failure: TranRequestFailure) -> String {
        let status = failure.status.map(String.init) ?? "-"
        return "request failed code=\(failure.spec.wireCode) status=\(status) request_id=\(failure.requestId ?? "-")"
    }

    /// Logs at the catalogue level only — for background calls the user did not start.
    func log(_ failure: TranRequestFailure) {
        let message = Self.logLine(failure)
        switch failure.spec.logLevel {
        case .debug: Self.logger.debug("\(message, privacy: .public)")
        case .info: Self.logger.info("\(message, privacy: .public)")
        case .warn: Self.logger.warning("\(message, privacy: .public)")
        case .error: Self.logger.error("\(message, privacy: .public)")
        }
    }

    func dismissToast() {
        toast = nil
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

    private func show(_ presentation: TranPresentation, messageKey: String, requestId: String?) {
        guard case let .toast(tone, duration) = presentation else { return }
        toast = Toast(
            tone: tone,
            message: Self.message(messageKey),
            reference: requestId.map { L10n.Errors.reference($0) },
            durationMs: toastDurationMs(duration: duration)
        )
    }
}
