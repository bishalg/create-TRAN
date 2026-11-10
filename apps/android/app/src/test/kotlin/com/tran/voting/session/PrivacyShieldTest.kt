// Verifies: REQ-SEC-023
package com.tran.voting.session

import android.app.Activity
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The recents privacy shield: the decision, what it switches, and the debug-only opt-out. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PrivacyShieldTest {
    private fun applied(measure: PrivacyMeasure): List<String> {
        val calls = mutableListOf<String>()
        applyPrivacyMeasure({ enabled -> calls += "recents=$enabled" }, measure)
        return calls
    }

    @Test
    fun `a signed-in screen is hidden from recents`() {
        assertEquals(PrivacyMeasure.HIDE_FROM_RECENTS, privacyMeasure(signedIn = true, debugBuild = false, disableRequested = false))
        assertEquals(PrivacyMeasure.HIDE_FROM_RECENTS, privacyMeasure(signedIn = true, debugBuild = true, disableRequested = false))
        assertEquals(listOf("recents=false"), applied(PrivacyMeasure.HIDE_FROM_RECENTS))
    }

    @Test
    fun `signed out, the measure is undone`() {
        assertEquals(PrivacyMeasure.NONE, privacyMeasure(signedIn = false, debugBuild = false, disableRequested = false))
        assertEquals(listOf("recents=true"), applied(PrivacyMeasure.NONE))
    }

    @Test
    fun `only a debug build honours the launch flag that switches the shield off`() {
        assertEquals(PrivacyMeasure.NONE, privacyMeasure(signedIn = true, debugBuild = true, disableRequested = true))
        assertEquals(PrivacyMeasure.HIDE_FROM_RECENTS, privacyMeasure(signedIn = true, debugBuild = false, disableRequested = true))
    }

    /** Records what the activity is told; Robolectric's shadow does not expose the recents switch. */
    class RecordingActivity : Activity() {
        val recents = mutableListOf<Boolean>()

        override fun setRecentsScreenshotEnabled(enabled: Boolean) {
            recents += enabled
            super.setRecentsScreenshotEnabled(enabled)
        }
    }

    @Test
    fun `the activity target switches the activity's recents screenshot and nothing else`() {
        val activity = Robolectric.buildActivity(RecordingActivity::class.java).setup().get()
        val target = ActivityPrivacyShieldTarget(activity)
        val flags = activity.window.attributes.flags

        target.setRecentsScreenshotEnabled(false)
        target.setRecentsScreenshotEnabled(true)
        assertEquals(listOf(false, true), activity.recents)
        assertEquals("the window's flags are left alone, so in-app screenshots still work", flags, activity.window.attributes.flags)
    }
}
