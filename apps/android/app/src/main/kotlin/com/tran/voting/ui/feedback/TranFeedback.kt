// Verifies: REQ-ERR-006 REQ-ERR-007 REQ-ERR-008 REQ-ERR-010 REQ-ERR-012 REQ-ERR-014
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
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranPresentation
import uniffi.tran_uniffi.TranToastAdmission
import uniffi.tran_uniffi.TranToastKey
import uniffi.tran_uniffi.TranToastTone
import uniffi.tran_uniffi.TranUserAction
import uniffi.tran_uniffi.actionSpec
import uniffi.tran_uniffi.admitToast
import uniffi.tran_uniffi.toastDurationMs

/** A self-dismissing, non-blocking message; strings stay resource ids until rendered. */
data class TranToastState(
    val tone: TranToastTone,
    /** The catalogue key: with [tone], what makes two toasts "the same" (REQ-ERR-012). */
    val messageKey: String,
    val messageRes: Int,
    val requestId: String?,
    val durationMs: Long,
    val id: String = UUID.randomUUID().toString(),
    /** Bumped when the same toast arrives again, so its timer restarts. */
    val generation: Int = 0,
)

/** A blocking choice waiting for the user. */
class TranConfirmation(
    val titleRes: Int,
    val bodyRes: Int,
    val confirmRes: Int,
    val cancelRes: Int = TranStrings.Common.cancel,
    val destructive: Boolean,
    val onConfirm: () -> Unit,
)

/**
 * The Android implementation of the Rust feedback policy (ADR-0028, ADR-0036). Screens say *what*
 * happened; the catalogue decides *how* the user hears about it. `TranFeedbackHost` renders it.
 */
class TranFeedback(
    /** Injected in JVM tests, where `android.util.Log` is unavailable. */
    private val log: (TranLogLevel, String) -> Unit = ::tranLogcat,
) {
    /** Oldest first; at most `toastPolicy().maxVisible` (REQ-ERR-012). */
    var toasts: List<TranToastState> by mutableStateOf(emptyList())
        private set

    /** The newest toast, if any. */
    val toast: TranToastState? get() = toasts.lastOrNull()

    private val errorHandlers = mutableMapOf<TranErrorCode, () -> Unit>()
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

    /**
     * Runs [perform] when the user confirms the dialog a failure with [code] opens — "Sign in
     * again" for `auth.session_expired` (REQ-ERR-010). One handler per code; the latest wins.
     */
    fun onErrorConfirmed(code: TranErrorCode, perform: () -> Unit) {
        errorHandlers[code] = perform
    }

    fun cancelConfirmation() {
        confirmation = null
    }

    /**
     * Logs the failure and shows it when it is a toast or a dialog. Returns the presentation so the
     * screen can render inline and banner states, which it owns (REQ-ERR-006).
     */
    fun report(failure: TranRequestFailure): TranPresentation {
        log(failure)
        val spec = failure.spec
        val presentation = spec.presentation
        show(presentation, spec.messageKey, failure.requestId)
        val copy = errorDialogCopy(failure.code)
        if (presentation is TranPresentation.Dialog && copy != null) {
            val code = failure.code
            confirmation = TranConfirmation(
                titleRes = messageRes(spec.messageKey),
                bodyRes = copy.body,
                confirmRes = copy.confirm,
                cancelRes = copy.cancel,
                destructive = presentation.destructive,
                onConfirm = {
                    confirmation = null
                    errorHandlers[code]?.invoke()
                },
            )
        }
        return presentation
    }

    /**
     * Logs at the catalogue level — for background calls the user did not start — and hands
     * `error`-level failures to the reporter (REQ-ERR-014).
     */
    fun log(failure: TranRequestFailure) {
        log(failure.spec.logLevel, logLine(failure))
        TranReporting.report(failure)
    }

    /** Dismisses the toast with [id], or the newest one. */
    fun dismissToast(id: String? = null) {
        val target = id ?: toasts.lastOrNull()?.id ?: return
        toasts = toasts.filterNot { it.id == target }
    }

    private fun show(presentation: TranPresentation, messageKey: String, requestId: String?) {
        if (presentation !is TranPresentation.Toast) return
        val durationMs = toastDurationMs(presentation.duration).toLong()
        val visible = toasts.map { TranToastKey(messageKey = it.messageKey, tone = it.tone) }
        when (val admission = admitToast(visible, TranToastKey(messageKey = messageKey, tone = presentation.tone))) {
            is TranToastAdmission.Refresh -> {
                val index = admission.index.toInt()
                toasts = toasts.mapIndexed { i, toast ->
                    if (i == index) {
                        toast.copy(generation = toast.generation + 1, requestId = requestId, durationMs = durationMs)
                    } else {
                        toast
                    }
                }
            }
            is TranToastAdmission.Append -> {
                toasts = toasts.drop(admission.evictOldest.toInt()) + TranToastState(
                    tone = presentation.tone,
                    messageKey = messageKey,
                    messageRes = messageRes(messageKey),
                    requestId = requestId,
                    durationMs = durationMs,
                )
            }
        }
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

        /** Dialog copy for failures the catalogue presents as a dialog; a parity test keeps it complete. */
        fun errorDialogCopy(code: TranErrorCode): ErrorDialogCopy? = when (code) {
            TranErrorCode.AUTH_SESSION_EXPIRED -> ErrorDialogCopy(
                body = TranStrings.Errors.sessionExpiredBody,
                confirm = TranStrings.Auth.signInAgain,
                cancel = TranStrings.Common.notNow,
            )
            else -> null
        }
    }
}

/** The app's one logcat writer (REQ-ROB-007): callers pass a `logLine`, never a payload. */
internal fun tranLogcat(level: TranLogLevel, message: String) {
    val tag = "TranFeedback"
    when (level) {
        TranLogLevel.DEBUG -> Log.d(tag, message)
        TranLogLevel.INFO -> Log.i(tag, message)
        TranLogLevel.WARN -> Log.w(tag, message)
        TranLogLevel.ERROR -> Log.e(tag, message)
    }
}

/** Body, confirm and cancel labels of a failure's dialog (string resource ids). */
data class ErrorDialogCopy(val body: Int, val confirm: Int, val cancel: Int)

/** One feedback center per app, provided by `NavigationCoordinator`. */
val LocalTranFeedback = staticCompositionLocalOf { TranFeedback() }
