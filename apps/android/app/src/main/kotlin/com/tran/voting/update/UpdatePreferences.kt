// Verifies: REQ-VER-010 REQ-VER-011
package com.tran.voting.update

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import com.tran.voting.BuildConfig
import com.tran.voting.ui.feedback.tranLogcat
import uniffi.tran_uniffi.TranLogLevel

/** The recommended version the person last answered "Not now" for (REQ-VER-010). */
interface DismissedUpdate {
    /** `null` when never dismissed; `""` when the server named no version. */
    var version: String?
}

/** For tests and previews: forgotten when the process ends. */
class InMemoryDismissedUpdate(override var version: String? = null) : DismissedUpdate

/**
 * [DismissedUpdate] in plain `SharedPreferences` (`tran.update`, private to the app): a preference,
 * never a credential (spec 028), so not the vault. It stays in backup and device transfer: restored,
 * it only keeps a prompt the person already declined for that version from asking again.
 * `SessionVaultGuardTest` pins that this is all it writes.
 */
class UpdatePreferences(private val preferences: SharedPreferences) : DismissedUpdate {
    constructor(context: Context) : this(context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE))

    override var version: String?
        get() = preferences.getString(KEY_DISMISSED_VERSION, null)
        set(value) {
            preferences.edit().putString(KEY_DISMISSED_VERSION, value).apply()
        }

    companion object {
        const val PREFERENCES = "tran.update"
        private const val KEY_DISMISSED_VERSION = "dismissed_version"
    }
}

/**
 * The app's store page (REQ-VER-011): `TRAN_ANDROID_STORE_URL` at build time, else the
 * `https://tran.example/…` placeholder the scaffolder's fork replaces. Never computed at run time.
 */
object StorePage {
    val url: String = BuildConfig.TRAN_ANDROID_STORE_URL

    /** Opens [url] in the Play Store app or a browser, outside this task; with neither, it only logs. */
    fun open(context: Context) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            tranLogcat(TranLogLevel.WARN, "store page has no app to open it")
        }
    }
}
