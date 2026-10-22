// Verifies: REQ-LOAD-006
package com.tran.voting.ui

import android.provider.Settings
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.tran.voting.generated.TranMotionDuration

/**
 * Motion from the generated token (`TranMotionDuration`), the Android twin of iOS `TranMotion`.
 * Reduced motion — the animator duration scale set to 0 in the developer or accessibility
 * settings — makes every change instant (REQ-LOAD-006).
 */
object TranMotion {
    fun <T> spec(reduceMotion: Boolean): FiniteAnimationSpec<T> =
        if (reduceMotion) snap() else tween(TranMotionDuration.baseMs)
}

/** Whether the user turned animations off (animator duration scale `0`). */
@Composable
fun rememberReduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) {
        Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}
