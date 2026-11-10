package com.tran.voting.permissions

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.tran.voting.ui.feedback.tranLogcat
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.TranPermissionStep
import uniffi.tran_uniffi.permissionStep

/** What the "Use my location" control shows besides itself. */
enum class LocationPrompt {
    NONE,

    /** The app's explanation, with "Continue" and "Not now". */
    PRIMING,

    /** The inline note after a permanent refusal, with "Open Settings". */
    SETTINGS_NOTE,
}

/**
 * "Use my location" fills the country (spec 026). Every decision is Rust's `permissionStep`; this
 * only carries it out. The system prompt follows a tap and "Continue", never anything else
 * (REQ-PRV-003). A refusal, a missing reading or a missing country leaves the typed country and
 * shows no error (REQ-PRV-004). The reading becomes a country on the device and is dropped at once;
 * it is never logged, stored or sent (REQ-PRV-006).
 *
 * The suspend functions return the country to fill in, or `null` to keep the one typed.
 */
class LocationCountry(
    private val gateway: PermissionGateway,
    private val geocoder: CountryGeocoder,
    // Events only, never a reading: the step taken or why the country stayed (REQ-ROB-007).
    private val log: (TranLogLevel, String) -> Unit = ::tranLogcat,
) {
    private val id = TranPermissionId.LOCATION_APPROXIMATE

    var prompt by mutableStateOf(LocationPrompt.NONE)
        private set

    /** A tap on the control. */
    suspend fun use(): String? = next(primed = false)

    /** "Continue" on the priming. */
    suspend fun proceed(): String? {
        prompt = LocationPrompt.NONE
        return next(primed = true)
    }

    /** "Not now" (or back) on the priming: nothing was asked, so nothing was refused. */
    fun dismiss() {
        prompt = LocationPrompt.NONE
        log(TranLogLevel.DEBUG, "location priming dismissed")
    }

    /** "Open Settings" in the note. */
    fun openSettings() = gateway.openSettings()

    private suspend fun next(primed: Boolean): String? {
        val step = permissionStep(gateway.status(id), primed)
        log(TranLogLevel.DEBUG, "location permission step=${step.name.lowercase()}")
        return when (step) {
            TranPermissionStep.SHOW_PRIMING -> {
                prompt = LocationPrompt.PRIMING
                null
            }
            TranPermissionStep.OFFER_SETTINGS -> {
                prompt = LocationPrompt.SETTINGS_NOTE
                null
            }
            TranPermissionStep.USE_FEATURE -> country()
            TranPermissionStep.REQUEST_SYSTEM -> {
                prompt = LocationPrompt.NONE
                // Asked once per Continue: whatever the answer, the next tap decides again.
                // A refusal falls back quietly; the Settings note waits for a later tap.
                val answer = gateway.request(id)
                if (permissionStep(answer, true) == TranPermissionStep.USE_FEATURE) country() else fallback("refused")
            }
        }
    }

    private suspend fun country(): String? {
        prompt = LocationPrompt.NONE
        val fix = gateway.locationFix() ?: return fallback("no_fix")
        val code = geocoder.countryCode(fix)?.uppercase()
        return if (code != null && ISO_ALPHA2.matches(code)) {
            log(TranLogLevel.DEBUG, "location country filled")
            code
        } else {
            fallback("no_country")
        }
    }

    private fun fallback(why: String): String? {
        log(TranLogLevel.DEBUG, "location fallback=keep_manual_entry why=$why")
        return null
    }

    private companion object {
        val ISO_ALPHA2 = Regex("^[A-Z]{2}$")
    }
}
