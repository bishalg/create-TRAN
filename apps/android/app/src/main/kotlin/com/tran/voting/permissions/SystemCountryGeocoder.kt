package com.tran.voting.permissions

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.Locale
import kotlin.coroutines.resume

/**
 * The platform `Geocoder`: a reading becomes a country code on the device (REQ-PRV-006). It may use
 * the network itself; without a geocoder, or when it fails, the answer is `null` and the country
 * stays as typed (ADR-0043). API 33+ uses the listener; below it the blocking call runs on [io].
 */
class SystemCountryGeocoder(
    private val context: Context,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : CountryGeocoder {
    override suspend fun countryCode(fix: LocationFix): String? {
        if (!Geocoder.isPresent()) return null
        val geocoder = Geocoder(context, Locale.ROOT)
        val address = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                suspendCancellableCoroutine { continuation ->
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
            } else {
                withContext(io) {
                    @Suppress("DEPRECATION") // the blocking call API 33 replaced with the listener
                    geocoder.getFromLocation(fix.latitude, fix.longitude, 1)?.firstOrNull()
                }
            }
        } catch (unavailable: IOException) {
            null
        } catch (invalid: IllegalArgumentException) {
            null
        }
        return address?.countryCode
    }
}
