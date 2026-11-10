// Verifies: REQ-SEC-023
package com.tran.voting.session

import android.app.Activity

/** How the app keeps signed-in content out of the recents thumbnail. */
enum class PrivacyMeasure {
    /** Nothing to hide (signed out), or a debug screenshot run switched it off. */
    NONE,

    /** `Activity.setRecentsScreenshotEnabled(false)`; screenshots inside the app still work. */
    HIDE_FROM_RECENTS,
}

/**
 * The decision (REQ-SEC-023). [disableRequested] is the debug launch flag
 * [EXTRA_DISABLE_PRIVACY_SHIELD]; a release build ([debugBuild] false) ignores it.
 */
fun privacyMeasure(signedIn: Boolean, debugBuild: Boolean, disableRequested: Boolean): PrivacyMeasure =
    when {
        !signedIn -> PrivacyMeasure.NONE
        debugBuild && disableRequested -> PrivacyMeasure.NONE
        else -> PrivacyMeasure.HIDE_FROM_RECENTS
    }

/** The window's recents switch; an activity in the app, a recorder in tests. */
fun interface PrivacyShieldTarget {
    fun setRecentsScreenshotEnabled(enabled: Boolean)
}

/** Applies [measure], undoing it when it is [PrivacyMeasure.NONE]. */
fun applyPrivacyMeasure(target: PrivacyShieldTarget, measure: PrivacyMeasure) {
    target.setRecentsScreenshotEnabled(measure != PrivacyMeasure.HIDE_FROM_RECENTS)
}

/** The real target: the activity's own recents switch, which leaves the window's flags alone. */
class ActivityPrivacyShieldTarget(private val activity: Activity) : PrivacyShieldTarget {
    override fun setRecentsScreenshotEnabled(enabled: Boolean) = activity.setRecentsScreenshotEnabled(enabled)
}

/** `adb shell am start … --ez tran.disablePrivacyShield true`: honoured by debug builds only. */
const val EXTRA_DISABLE_PRIVACY_SHIELD = "tran.disablePrivacyShield"
