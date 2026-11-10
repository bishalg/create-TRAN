// Verifies: REQ-SEC-023
package com.tran.voting.session

import android.app.Activity
import android.os.Build
import android.view.WindowManager

/** How the app keeps signed-in content out of the recents thumbnail. */
enum class PrivacyMeasure {
    /** Nothing to hide (signed out), or a debug screenshot run switched it off. */
    NONE,

    /** API 33+: `Activity.setRecentsScreenshotEnabled(false)`; screenshots in the app still work. */
    HIDE_FROM_RECENTS,

    /** Before API 33 the only tool: `FLAG_SECURE` on the window. */
    FLAG_SECURE,
}

/**
 * The decision (REQ-SEC-023). [disableRequested] is the debug launch flag
 * [EXTRA_DISABLE_PRIVACY_SHIELD]; a release build ([debugBuild] false) ignores it.
 */
fun privacyMeasure(signedIn: Boolean, sdkInt: Int, debugBuild: Boolean, disableRequested: Boolean): PrivacyMeasure =
    when {
        !signedIn -> PrivacyMeasure.NONE
        debugBuild && disableRequested -> PrivacyMeasure.NONE
        sdkInt >= RECENTS_SCREENSHOT_API -> PrivacyMeasure.HIDE_FROM_RECENTS
        else -> PrivacyMeasure.FLAG_SECURE
    }

/** The two switches a window offers; an activity in the app, a recorder in tests. */
interface PrivacyShieldTarget {
    fun setRecentsScreenshotEnabled(enabled: Boolean)

    fun setSecure(secure: Boolean)
}

/** Applies [measure], undoing it when it is [PrivacyMeasure.NONE]; only the API level's own switch is touched. */
fun applyPrivacyMeasure(target: PrivacyShieldTarget, measure: PrivacyMeasure, sdkInt: Int) {
    if (sdkInt >= RECENTS_SCREENSHOT_API) {
        target.setRecentsScreenshotEnabled(measure != PrivacyMeasure.HIDE_FROM_RECENTS)
    } else {
        target.setSecure(measure == PrivacyMeasure.FLAG_SECURE)
    }
}

/** The real target: the activity's window. */
class ActivityPrivacyShieldTarget(private val activity: Activity) : PrivacyShieldTarget {
    override fun setRecentsScreenshotEnabled(enabled: Boolean) {
        if (Build.VERSION.SDK_INT >= RECENTS_SCREENSHOT_API) activity.setRecentsScreenshotEnabled(enabled)
    }

    override fun setSecure(secure: Boolean) {
        if (secure) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}

/** `adb shell am start … --ez tran.disablePrivacyShield true`: honoured by debug builds only. */
const val EXTRA_DISABLE_PRIVACY_SHIELD = "tran.disablePrivacyShield"

private const val RECENTS_SCREENSHOT_API = Build.VERSION_CODES.TIRAMISU
