// Verifies: REQ-LOAD-005 REQ-NAT-003 REQ-NAT-005 REQ-NAT-006 REQ-NAT-010 REQ-SCR-002
package com.tran.voting.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.graphics.ColorUtils
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.tran.voting.api.TranApiClient
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranBrandTokens
import com.tran.voting.generated.TranStrings
import com.tran.voting.generated.TranTheme
import com.tran.voting.generated.labelRes
import com.tran.voting.generated.tranColorScheme
import com.tran.voting.ui.atoms.LocalTranPalette
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * What the screen contract's verbs cannot express (docs/TESTING.md, "Hand-written suites that
 * remain"): every control's spoken label and role, text contrast in every registry palette, and the
 * copy of the fallback caption. Every shared journey runs from `screens.json` in
 * `ScreenContractTest`. The device check runs against the real Rust core through UniFFI.
 */
@RunWith(AndroidJUnit4::class)
class VotingHomeAccessibilityTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    /** Mirrors MainActivity: the screen receives a registry palette, never a light/dark flag. */
    private fun setVotingScreen(api: TranApiClient = TranApiClient()) {
        compose.setContent {
            val palette = TranBrandTokens.palette(TranTheme.DARK)
            MaterialTheme(colorScheme = tranColorScheme(palette)) {
                CompositionLocalProvider(LocalTranPalette provides palette) {
                    VotingHomeScreen(theme = TranTheme.DARK, onThemeChange = {}, api = api)
                }
            }
        }
    }

    /** Labels and roles are not contract verbs: the spoken name of every control (REQ-NAT-003). */
    @Test
    fun everyControlHasASpokenLabelAndRole() {
        setVotingScreen()
        compose.onNodeWithText(context.getString(TranStrings.Eligibility.ageLabel)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(TranStrings.Eligibility.countryLabel)).assertIsDisplayed()
        compose.onNodeWithTag(ScreenContract.Eligibility.checkButton)
            .assertTextEquals(context.getString(TranStrings.Eligibility.checkOffline))
            .assertHasClickAction()
        TranTheme.entries.forEach { mode ->
            compose.onNodeWithText(context.getString(mode.labelRes)).assertHasClickAction()
        }
    }

    /**
     * REQ-LOAD-005: once the retries against an unreachable API are spent, the device decides and
     * the caption says so. The scenario only requires a caption: the web's device mode never asks
     * the server, so the fallback copy is native-only and pinned here.
     */
    @Test
    fun anUnreachableApiLabelsTheVerdictAsCheckedOnTheDevice() {
        // 127.0.0.1:1 refuses connections on the device; the debug network config still allows
        // loopback, so only the reachability check fails (REQ-NAT-011).
        setVotingScreen(api = TranApiClient(baseUrl = "http://127.0.0.1:1"))
        compose.onNodeWithTag(ScreenContract.Eligibility.checkButton).performClick()

        val fallback = context.getString(TranStrings.Eligibility.resultSourceFallback)
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText(fallback).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag(ScreenContract.Eligibility.verdictSource)
            .assertTextEquals(fallback)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
    }

    /** Contrast is a palette property, not an element's (REQ-NAT-006). */
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

    private fun assertContrast(mode: TranTheme, pair: String, foreground: Color, background: Color) {
        val ratio = ColorUtils.calculateContrast(foreground.toArgb(), background.toArgb())
        assertTrue("$mode $pair contrast is $ratio:1, needs at least 4.5:1", ratio >= 4.5)
    }
}
