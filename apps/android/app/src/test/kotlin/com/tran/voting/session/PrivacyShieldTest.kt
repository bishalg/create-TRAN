// Verifies: REQ-SEC-023
package com.tran.voting.session

import android.app.Activity
import android.view.WindowManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The recents privacy shield: the decision, what it switches, and the debug-only opt-out. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PrivacyShieldTest {
    private class Recorder : PrivacyShieldTarget {
        val calls = mutableListOf<String>()

        override fun setRecentsScreenshotEnabled(enabled: Boolean) {
            calls += "recents=$enabled"
        }

        override fun setSecure(secure: Boolean) {
            calls += "secure=$secure"
        }
    }

    private fun applied(measure: PrivacyMeasure, sdk: Int) = Recorder().also { applyPrivacyMeasure(it, measure, sdk) }.calls

    @Test
    fun `a signed-in screen is hidden from recents on API 33 and later`() {
        for (sdk in listOf(33, 34, 35)) {
            assertEquals(PrivacyMeasure.HIDE_FROM_RECENTS, privacyMeasure(signedIn = true, sdkInt = sdk, debugBuild = false, disableRequested = false))
        }
        assertEquals(listOf("recents=false"), applied(PrivacyMeasure.HIDE_FROM_RECENTS, 33))
    }

    @Test
    fun `before API 33 a signed-in screen is secure`() {
        for (sdk in listOf(26, 30, 32)) {
            assertEquals(PrivacyMeasure.FLAG_SECURE, privacyMeasure(signedIn = true, sdkInt = sdk, debugBuild = true, disableRequested = false))
        }
        assertEquals(listOf("secure=true"), applied(PrivacyMeasure.FLAG_SECURE, 32))
    }

    @Test
    fun `signed out, the measure is undone on each API level`() {
        assertEquals(PrivacyMeasure.NONE, privacyMeasure(signedIn = false, sdkInt = 35, debugBuild = false, disableRequested = false))
        assertEquals(listOf("recents=true"), applied(PrivacyMeasure.NONE, 35))
        assertEquals(listOf("secure=false"), applied(PrivacyMeasure.NONE, 26))
    }

    @Test
    fun `only a debug build honours the launch flag that switches the shield off`() {
        assertEquals(PrivacyMeasure.NONE, privacyMeasure(signedIn = true, sdkInt = 35, debugBuild = true, disableRequested = true))
        assertEquals(PrivacyMeasure.HIDE_FROM_RECENTS, privacyMeasure(signedIn = true, sdkInt = 35, debugBuild = false, disableRequested = true))
        assertEquals(PrivacyMeasure.FLAG_SECURE, privacyMeasure(signedIn = true, sdkInt = 30, debugBuild = false, disableRequested = true))
    }

    @Test
    fun `the activity target sets and clears FLAG_SECURE on its window`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val target = ActivityPrivacyShieldTarget(activity)
        fun secure() = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

        target.setSecure(true)
        assertTrue(secure())
        target.setSecure(false)
        assertTrue(!secure())
        // On API 33+ the recents switch leaves the window's flags alone, so in-app screenshots still work.
        target.setRecentsScreenshotEnabled(false)
        assertTrue(!secure())
    }
}
