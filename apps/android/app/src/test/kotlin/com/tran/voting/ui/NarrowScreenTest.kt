// Verifies: REQ-NAT-013
package com.tran.voting.ui

import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.height
import androidx.compose.ui.unit.width
import com.tran.voting.NavigationCoordinator
import com.tran.voting.generated.TranTheme
import com.tran.voting.generated.labelRes
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.testing.FakeApis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The narrowest phone the app supports (320 × 640 dp, also the default CI emulator): every control
 * keeps its full size inside the screen, and no label breaks inside a word.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w320dp-h640dp-mdpi")
// Real font metrics: the legacy mode measures text too small and hides overflow.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NarrowScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun text(res: Int): String = RuntimeEnvironment.getApplication().getString(res)

    private fun assertWhollyOnScreen(node: SemanticsNodeInteraction, name: String) {
        val bounds = node.getUnclippedBoundsInRoot()
        val screen = compose.onRoot().getUnclippedBoundsInRoot()
        assertTrue("$name is ${bounds.width} wide, under the 48 dp touch floor", bounds.width >= 48.dp)
        assertTrue("$name ends at ${bounds.right}, past the ${screen.right} screen", bounds.right <= screen.right)
    }

    @Test
    fun `REQ-NAT-013 the voter can reach sign out and every theme on a 320 dp screen`() {
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy()) }
        compose.waitUntil(5_000) { compose.onAllNodes(hasTestTag("sign-out-button")).fetchSemanticsNodes().isNotEmpty() }

        assertWhollyOnScreen(compose.onNodeWithTag("sign-out-button"), "sign out")
        val chips = TranTheme.entries.map { mode -> mode to compose.onNodeWithText(text(mode.labelRes)) }
        chips.forEach { (mode, chip) -> assertWhollyOnScreen(chip, "theme $mode") }
        // A label broken inside a word ("Se/pi/a") makes its chip taller than the others.
        val heights = chips.map { (_, chip) -> chip.getUnclippedBoundsInRoot().height }.toSet()
        assertEquals("theme chips differ in height: $heights", 1, heights.size)
    }

    @Test
    fun `REQ-NAT-013 the auditor can reach sign out on a 320 dp screen`() {
        compose.setContent { AuditorScreen(onSignOut = {}) }
        assertWhollyOnScreen(compose.onNodeWithTag("sign-out-button"), "sign out")
    }

    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }
}
