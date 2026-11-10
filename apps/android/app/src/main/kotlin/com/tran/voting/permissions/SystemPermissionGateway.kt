package com.tran.voting.permissions

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Looper
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.TranPermissionStatus
import kotlin.coroutines.resume

/**
 * The only code that asks Android for a permission or a location (REQ-PRV-003, guarded by
 * `permission-declarations.test.ts`). Construct it in `onCreate`: the result launcher must be
 * registered before the activity starts.
 *
 * How the status is derived. Android reports only "granted or not" and, through
 * `shouldShowRequestPermissionRationale`, "refused once and the system may still ask". That rationale
 * flag is `false` both before the first ask and after "Don't ask again" (or a second refusal), so the
 * app records in its own preferences that it has asked. That is not a credential, so it lives in plain
 * `SharedPreferences`, not the session vault.
 *
 * - granted → `GRANTED_APPROXIMATE`: the app only ever asks for coarse location (REQ-PRV-006);
 * - never asked → `NOT_DETERMINED`;
 * - asked, rationale shown → `DENIED` (the system can ask again);
 * - asked, no rationale → `DENIED_PERMANENTLY` (only Settings can change it).
 *
 * "Asked" is written only once an answer is known (see [request]), so a prompt dismissed without an
 * answer does not count.
 *
 * If the person resets the permission in Settings to "Ask every time" after a permanent refusal, the
 * last rule still reads it as permanent; the note's "Open Settings" is then a detour, never a nag.
 */
class SystemPermissionGateway(
    private val activity: ComponentActivity,
    private val asked: SharedPreferences = activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE),
) : PermissionGateway {
    private var pending: CompletableDeferred<Boolean>? = null
    private val launcher: ActivityResultLauncher<String> =
        activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            pending?.complete(granted)
            pending = null
        }

    override fun status(id: TranPermissionId): TranPermissionStatus {
        val permission = manifestPermission(id)
        return when {
            activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED ->
                TranPermissionStatus.GRANTED_APPROXIMATE
            !asked.getBoolean(askedKey(id), false) -> TranPermissionStatus.NOT_DETERMINED
            activity.shouldShowRequestPermissionRationale(permission) -> TranPermissionStatus.DENIED
            else -> TranPermissionStatus.DENIED_PERMANENTLY
        }
    }

    override suspend fun request(id: TranPermissionId): TranPermissionStatus {
        val permission = manifestPermission(id)
        val answer = CompletableDeferred<Boolean>().also { pending = it }
        launcher.launch(permission)
        val granted = answer.await()
        // A first prompt offers no "Don't ask again", so a refusal there turns the rationale on. A
        // first prompt that ends with neither (dismissed outside the dialog) was not answered: it
        // stays "never asked" rather than reading as a permanent refusal. Later prompts were
        // recorded by the first refusal already.
        if (granted || activity.shouldShowRequestPermissionRationale(permission)) {
            asked.edit().putBoolean(askedKey(id), true).apply()
        }
        return status(id)
    }

    /**
     * One reading from the first enabled provider. With coarse permission only the network provider
     * is open below API 31; from API 31 the fused and GPS providers answer coarse callers too, with
     * the position blurred by the system.
     */
    override suspend fun locationFix(): LocationFix? {
        val manager = activity.getSystemService(LocationManager::class.java) ?: return null
        val providers = buildList {
            add(LocationManager.NETWORK_PROVIDER)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                add(LocationManager.FUSED_PROVIDER)
                add(LocationManager.GPS_PROVIDER)
            }
        }
        val provider = providers.firstOrNull { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
            ?: return null
        val location = try {
            withTimeoutOrNull(FIX_TIMEOUT_MS) { currentLocation(manager, provider) }
        } catch (refused: SecurityException) {
            null
        }
        return location?.let { LocationFix(it.latitude, it.longitude) }
    }

    override fun openSettings() {
        activity.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private suspend fun currentLocation(manager: LocationManager, provider: String): Location? =
        suspendCancellableCoroutine { continuation ->
            val signal = CancellationSignal()
            continuation.invokeOnCancellation { signal.cancel() }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                manager.getCurrentLocation(provider, signal, activity.mainExecutor) { continuation.resume(it) }
            } else {
                val listener = object : LocationListener {
                    override fun onLocationChanged(location: Location) {
                        if (continuation.isActive) continuation.resume(location)
                    }

                    @Deprecated("Deprecated in API 29; required below it")
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

                    override fun onProviderDisabled(provider: String) {
                        if (continuation.isActive) continuation.resume(null)
                    }
                }
                signal.setOnCancelListener { manager.removeUpdates(listener) }
                @Suppress("DEPRECATION") // the single-update call API 30 replaced with getCurrentLocation
                manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            }
        }

    private fun manifestPermission(id: TranPermissionId): String = when (id) {
        TranPermissionId.LOCATION_APPROXIMATE -> Manifest.permission.ACCESS_COARSE_LOCATION
    }

    private fun askedKey(id: TranPermissionId) = "asked.${id.code}"

    private companion object {
        const val PREFERENCES = "tran.permissions"
        const val FIX_TIMEOUT_MS = 10_000L
    }
}
