// Verifies: REQ-NAT-002 REQ-NAT-003 REQ-NAT-004 REQ-NAT-005 REQ-NAT-006 REQ-NAT-007
package com.tran.voting.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.core.graphics.ColorUtils
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.tran.voting.generated.TranBrandTokens
import com.tran.voting.generated.TranTheme
import com.tran.voting.generated.labelRes
import com.tran.voting.generated.tranColorScheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented accessibility checks for the voter dashboard: spoken labels, the announced
 * verdict, touch-target sizes, text scaling, and every palette in the theme registry.
 * The device check runs against the real Rust core through UniFFI (no network).
 */
@RunWith(AndroidJUnit4::class)
class VotingHomeAccessibilityTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val density = context.resources.displayMetrics.density

    private fun label(mode: TranTheme): String = context.getString(mode.labelRes)

    /** Mirrors MainActivity: the screen receives a palette from the registry, never a light/dark flag. */
    private fun setVotingScreen(fontScale: Float = 1f) {
        compose.setContent {
            val current = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(current.density, fontScale)) {
                var theme by remember { mutableStateOf(TranTheme.DARK) }
                val palette = TranBrandTokens.palette(theme)
                MaterialTheme(colorScheme = tranColorScheme(palette)) {
                    VotingHomeScreen(palette = palette, theme = theme, onThemeChange = { theme = it })
                }
            }
        }
    }

    @Test
    fun everyControlHasASpokenLabelAndRole() {
        setVotingScreen()
        compose.onNodeWithText("Your age").assertIsDisplayed()
        compose.onNodeWithText("Country code").assertIsDisplayed()
        compose.onNodeWithTag("age-field").assertIsDisplayed()
        compose.onNodeWithTag("country-field").assertIsDisplayed()
        compose.onNodeWithTag("check-button").assertTextEquals("Check offline").assertHasClickAction()
        TranTheme.entries.forEach { mode ->
            compose.onNodeWithText(label(mode)).assertHasClickAction()
        }
    }

    @Test
    fun theVerdictIsAPoliteLiveRegion() {
        setVotingScreen()
        compose.onNodeWithTag("check-button").performClick()
        compose.onNodeWithTag("offline-result")
            .assertTextEquals("Age 20 meets the minimum voting age of 18 in NP.")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
    }

    @Test
    fun touchTargetsMeetFortyEightDp() {
        setVotingScreen()
        assertTouchTargetAtLeast48(compose.onNodeWithTag("check-button"), "check-button")
        assertTouchTargetAtLeast48(compose.onNodeWithTag("age-field"), "age-field")
        assertTouchTargetAtLeast48(compose.onNodeWithTag("country-field"), "country-field")
        TranTheme.entries.forEach { mode ->
            assertTouchTargetAtLeast48(compose.onNodeWithText(label(mode)), "theme $mode")
        }
    }

    @Test
    fun largestFontScaleKeepsTheVerdictReachable() {
        setVotingScreen(fontScale = 2f)
        compose.onNodeWithTag("check-button").performScrollTo().performClick()
        compose.onNodeWithTag("offline-result")
            .performScrollTo()
            .assertIsDisplayed()
            .assertTextEquals("Age 20 meets the minimum voting age of 18 in NP.")
    }

    @Test
    fun everyRegistryThemeIsSelectable() {
        setVotingScreen()
        TranTheme.entries.forEach { mode ->
            compose.onNodeWithText(label(mode)).performClick()
            compose.onNodeWithText(label(mode)).assertIsSelected()
        }
    }

    @Test
    fun everyRegistryThemeMeetsTextContrast() {
        TranTheme.entries.forEach { mode ->
            val palette = TranBrandTokens.palette(mode)
            assertContrast(mode, "textPrimary on background", palette.textPrimary, palette.background)
            assertContrast(mode, "textPrimary on surface", palette.textPrimary, palette.surface)
            val scheme = tranColorScheme(palette)
            assertContrast(mode, "action label on action fill", scheme.onPrimary, scheme.primary)
        }
    }

    /** Touch bounds, not visual bounds: Material3 enforces the 48dp floor on the touch target. */
    private fun assertTouchTargetAtLeast48(interaction: SemanticsNodeInteraction, label: String) {
        val bounds = interaction.fetchSemanticsNode().touchBoundsInRoot
        val width = bounds.right - bounds.left
        val height = bounds.bottom - bounds.top
        val minimum = 48f * density
        assertTrue(
            "$label touch target is ${width / density}×${height / density}dp, needs at least 48×48dp",
            width >= minimum && height >= minimum,
        )
    }

    private fun assertContrast(mode: TranTheme, pair: String, foreground: Color, background: Color) {
        val ratio = ColorUtils.calculateContrast(foreground.toArgb(), background.toArgb())
        assertTrue("$mode $pair contrast is $ratio:1, needs at least 4.5:1", ratio >= 4.5)
    }
}
