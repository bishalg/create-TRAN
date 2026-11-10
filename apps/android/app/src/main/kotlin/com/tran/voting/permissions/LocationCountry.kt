package com.tran.voting.permissions

import com.tran.voting.ui.feedback.tranLogcat
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranPermissionId

/**
 * "Use my location" fills the country (spec 026). The permission is a [PermissionFlow]; this adds
 * the reading. A refusal, a missing reading or a missing country leaves the typed country and shows
 * no error (REQ-PRV-004). The reading becomes a country on the device and is dropped at once; it is
 * never logged, stored or sent (REQ-PRV-006).
 *
 * The suspend functions return the country to fill in, or `null` to keep the one typed.
 */
class LocationCountry(
    private val gateway: PermissionGateway,
    private val geocoder: CountryGeocoder,
    // Events only, never a reading: the step taken or why the country stayed (REQ-ROB-007).
    private val log: (TranLogLevel, String) -> Unit = ::tranLogcat,
) {
    private val flow = PermissionFlow(gateway, TranPermissionId.LOCATION_APPROXIMATE, "location", log)

    val prompt: PermissionPrompt get() = flow.prompt

    /** A tap on the control. */
    suspend fun use(): String? = if (flow.tap()) country() else null

    /** "Continue" on the priming. */
    suspend fun proceed(): String? = if (flow.proceed()) country() else null

    /** "Not now" (or back) on the priming. */
    fun dismiss() = flow.dismiss()

    /** "Open Settings" in the note. */
    fun openSettings() = flow.openSettings()

    private suspend fun country(): String? {
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
        flow.fellBack(why)
        return null
    }

    private companion object {
        val ISO_ALPHA2 = Regex("^[A-Z]{2}$")
    }
}
