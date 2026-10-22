// Verifies: REQ-LOAD-006
package com.tran.voting.ui

import android.provider.Settings
import androidx.compose.animation.core.SnapSpec
import androidx.compose.animation.core.TweenSpec
import androidx.compose.ui.test.junit4.createComposeRule
import com.tran.voting.generated.TranMotionDuration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Motion reads the generated token and turns off when the user removed animations. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TranMotionTest {
    @get:Rule
    val compose = createComposeRule()

    private fun reduceMotionWith(scale: Float?): Boolean {
        val resolver = RuntimeEnvironment.getApplication().contentResolver
        if (scale != null) Settings.Global.putFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, scale)
        var reduce: Boolean? = null
        compose.setContent { reduce = rememberReduceMotion() }
        compose.waitForIdle()
        return reduce!!
    }

    @Test
    fun `REQ-LOAD-006 motion uses the generated base duration`() {
        val spec = TranMotion.spec<Float>(reduceMotion = false)
        assertTrue("expected a tween, got $spec", spec is TweenSpec<*>)
        assertEquals(TranMotionDuration.baseMs, (spec as TweenSpec<Float>).durationMillis)
    }

    @Test
    fun `REQ-LOAD-006 reduced motion yields no animation`() {
        val spec = TranMotion.spec<Float>(reduceMotion = true)
        assertTrue("expected a snap, got $spec", spec is SnapSpec<*>)
        assertEquals(0, (spec as SnapSpec<Float>).delay)
    }

    @Test
    fun `REQ-LOAD-006 an animator duration scale of zero means reduced motion`() {
        assertTrue(reduceMotionWith(0f))
    }

    @Test
    fun `REQ-LOAD-006 the default and a slowed scale keep motion`() {
        assertFalse("unset", reduceMotionWith(null))
    }

    @Test
    fun `REQ-LOAD-006 a slowed animator scale keeps motion`() {
        assertFalse(reduceMotionWith(2f))
    }
}
