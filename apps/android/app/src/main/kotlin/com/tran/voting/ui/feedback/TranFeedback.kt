// Verifies: REQ-ERR-006 REQ-ERR-007 REQ-ERR-008
package com.tran.voting.ui.feedback

import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import com.tran.voting.api.TranRequestFailure
import com.tran.voting.generated.TranStrings
import com.tran.voting.generated.feedbackMessageRes
import java.util.UUID
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranPresentation
import uniffi.tran_uniffi.TranToastTone
import uniffi.tran_uniffi.TranUserAction
import uniffi.tran_uniffi.actionSpec
import uniffi.tran_uniffi.toastDurationMs

/** A self-dismissing, non-blocking message; strings stay resource ids until rendered. */
data class TranToastState(
    val tone: TranToastTone,
    val messageRes: Int,
    val requestId: String?,
    val durationMs: Long,
    val id: String = UUID.randomUUID().toString(),
)

/** A blocking choice waiting for the user. */
class TranConfirmation(
    val titleRes: Int,
    val bodyRes: Int,
    val confirmRes: Int,
    val destructive: Boolean,
    val onConfirm: () -> Unit,
)

/**
 * The Android implementation of the Rust feedback policy (ADR-0028). Screens say *what* happened;
 * the catalogue decides *how* the user hears about it. `TranFeedbackHost` renders the state.
 */
class TranFeedback(
    /** Injected in JVM tests, where `android.util.Log` is unavailable. */
    private val log: (TranLogLevel, String) -> Unit = ::logcat,
) {
    var toast: TranToastState? by mutableStateOf(null)
        private set
    var confirmation: TranConfirmation? by mutableStateOf(null)
        private set

    /** Shows an action's acknowledgement when the catalogue makes it a toast (REQ-ERR-008). */
    fun acknowledge(action: TranUserAction) {
        val spec = actionSpec(action)
        show(spec.presentation, spec.messageKey, requestId = null)
    }

    /** Runs [perform] once the user agrees — immediately when the catalogue asks for no dialog (REQ-ERR-007). */
    fun confirm(action: TranUserAction, perform: () -> Unit) {
        val spec = actionSpec(action)
        val presentation = spec.presentation
        val copy = dialogCopy(action)
        if (presentation !is TranPresentation.Dialog || copy == null) {
            perform()
            return
        }
        confirmation = TranConfirmation(
            titleRes = messageRes(spec.messageKey),
            bodyRes = copy.first,
            confirmRes = copy.second,
            destructive = presentation.destructive,
            onConfirm = {
                confirmation = null
                perform()
            },
        )
    }

    fun cancelConfirmation() {
        confirmation = null
    }

    /**
     * Logs the failure and shows it when it is a toast. Returns the presentation so the screen can
     * render inline and banner states, which it owns (REQ-ERR-006).
     */
    fun report(failure: TranRequestFailure): TranPresentation {
        log(failure)
        val spec = failure.spec
        show(spec.presentation, spec.messageKey, failure.requestId)
        return spec.presentation
    }

    /** Logs at the catalogue level only — for background calls the user did not start. */
    fun log(failure: TranRequestFailure) {
        log(failure.spec.logLevel, logLine(failure))
    }

    fun dismissToast() {
        toast = null
    }

    private fun show(presentation: TranPresentation, messageKey: String, requestId: String?) {
        if (presentation !is TranPresentation.Toast) return
        toast = TranToastState(
            tone = presentation.tone,
            messageRes = messageRes(messageKey),
            requestId = requestId,
            durationMs = toastDurationMs(presentation.duration).toLong(),
        )
    }

    companion object {
        /** String resource for a catalogue key; `codegen` guarantees every key exists. */
        fun messageRes(key: String): Int = feedbackMessageRes[key] ?: TranStrings.Errors.unexpected

        /**
         * The one `request failed` event with `LOG_EVENT`'s fields (`fixtures/feedback.json`), as
         * logfmt; `-` marks a field the failure does not have (REQ-ROB-007).
         */
        fun logLine(failure: TranRequestFailure): String =
            "request failed code=${failure.spec.wireCode} status=${failure.status ?: "-"} " +
                "request_id=${failure.requestId ?: "-"}"

        /**
         * Body and confirm label per action; the title is the catalogue's `messageKey`. Exhaustive,
         * so a new action from Rust fails to compile until it has copy.
         */
        fun dialogCopy(action: TranUserAction): Pair<Int, Int>? = when (action) {
            TranUserAction.SIGN_OUT -> TranStrings.Auth.signOutConfirmBody to TranStrings.Common.signOut
            TranUserAction.SERVER_CHECK_SUCCEEDED -> null
        }
    }
}

private fun logcat(level: TranLogLevel, message: String) {
    val tag = "TranFeedback"
    when (level) {
        TranLogLevel.DEBUG -> Log.d(tag, message)
        TranLogLevel.INFO -> Log.i(tag, message)
        TranLogLevel.WARN -> Log.w(tag, message)
        TranLogLevel.ERROR -> Log.e(tag, message)
    }
}

/** One feedback center per app, provided by `NavigationCoordinator`. */
val LocalTranFeedback = staticCompositionLocalOf { TranFeedback() }
