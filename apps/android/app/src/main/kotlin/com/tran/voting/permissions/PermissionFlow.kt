package com.tran.voting.permissions

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.tran.voting.ui.feedback.tranLogcat
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.TranPermissionStep
import uniffi.tran_uniffi.permissionEntry
import uniffi.tran_uniffi.permissionStep
import java.util.Locale

/** What a permission's control shows besides itself. */
enum class PermissionPrompt {
    NONE,

    /** The app's explanation, with "Continue" and "Not now". */
    PRIMING,

    /** The inline note after a permanent refusal, with "Open Settings". */
    SETTINGS_NOTE,
}

/**
 * One permission asked in context (spec 026): every decision is Rust's `permissionStep`; this only
 * carries it out. The system prompt follows a tap and "Continue", never anything else (REQ-PRV-003).
 * A refusal shows nothing: the catalogue's fallback applies and the Settings note waits for a later
 * tap (REQ-PRV-004). "Use my location" and "Notify me" each drive one.
 */
class PermissionFlow(
    private val gateway: PermissionGateway,
    private val id: TranPermissionId,
    /** The feature's name in log lines (`location`, `notifications`). */
    private val name: String,
    // Events only: the step taken or why the feature fell back (REQ-ROB-007).
    private val log: (TranLogLevel, String) -> Unit = ::tranLogcat,
) {
    private val fallback = permissionEntry(id).fallback.name.lowercase(Locale.ROOT)

    var prompt by mutableStateOf(PermissionPrompt.NONE)
        private set

    /** A tap on the control; `true` when the feature may run now. */
    suspend fun tap(): Boolean = next(primed = false)

    /** "Continue" on the priming; `true` when the feature may run now. */
    suspend fun proceed(): Boolean {
        prompt = PermissionPrompt.NONE
        return next(primed = true)
    }

    /** "Not now" (or back) on the priming: nothing was asked, so nothing was refused. */
    fun dismiss() {
        prompt = PermissionPrompt.NONE
        log(TranLogLevel.DEBUG, "$name priming dismissed")
    }

    /** "Open Settings" in the note. */
    fun openSettings() = gateway.openSettings(id)

    /** The feature could not run: logged once with the catalogue's fallback. */
    fun fellBack(why: String) {
        log(TranLogLevel.DEBUG, "$name fallback=$fallback why=$why")
    }

    private suspend fun next(primed: Boolean): Boolean {
        val step = permissionStep(gateway.status(id), primed)
        log(TranLogLevel.DEBUG, "$name permission step=${step.name.lowercase(Locale.ROOT)}")
        return when (step) {
            TranPermissionStep.SHOW_PRIMING -> {
                prompt = PermissionPrompt.PRIMING
                false
            }
            TranPermissionStep.OFFER_SETTINGS -> {
                prompt = PermissionPrompt.SETTINGS_NOTE
                false
            }
            TranPermissionStep.USE_FEATURE -> {
                prompt = PermissionPrompt.NONE
                true
            }
            TranPermissionStep.REQUEST_SYSTEM -> {
                prompt = PermissionPrompt.NONE
                // Asked once per Continue: whatever the answer, the next tap decides again.
                val granted = permissionStep(gateway.request(id), true) == TranPermissionStep.USE_FEATURE
                if (!granted) fellBack("refused")
                granted
            }
        }
    }
}
