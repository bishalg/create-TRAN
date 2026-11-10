package com.tran.voting.permissions

import android.content.Context
import android.location.Address
import android.location.Geocoder
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.Locale
import kotlin.coroutines.resume

/**
 * The platform `Geocoder`: a reading becomes a country code on the device (REQ-PRV-006). It may use
 * the network itself; without a geocoder, or when it fails, the answer is `null` and the country
 * stays as typed (ADR-0043). The listener form answers off the calling thread, so nothing blocks.
 */
class SystemCountryGeocoder(private val context: Context) : CountryGeocoder {
    override suspend fun countryCode(fix: LocationFix): String? {
        if (!Geocoder.isPresent()) return null
        val geocoder = Geocoder(context, Locale.ROOT)
        val address = try {
            suspendCancellableCoroutine<Address?> { continuation ->
                geocoder.getFromLocation(
                    fix.latitude,
                    fix.longitude,
                    1,
                    object : Geocoder.GeocodeListener {
                        override fun onGeocode(addresses: MutableList<Address>) {
                            if (continuation.isActive) continuation.resume(addresses.firstOrNull())
                        }

                        override fun onError(errorMessage: String?) {
                            if (continuation.isActive) continuation.resume(null)
                        }
                    },
                )
            }
        } catch (invalid: IllegalArgumentException) {
            null
        }
        return address?.countryCode
    }
}
