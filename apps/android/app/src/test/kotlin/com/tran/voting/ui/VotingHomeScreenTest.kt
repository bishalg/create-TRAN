package com.tran.voting.ui

import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.printToString
import com.tran.voting.NavigationCoordinator
import com.tran.voting.api.TranApiClient
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranStrings
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.testing.FakeApis
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uniffi.tran_uniffi.loadingPolicy

/**
 * The voter dashboard's background server confirmation on the JVM (Robolectric, English): the
 * device verdict stays, a caption under it says who vouched for it, and a slow server is
 * acknowledged only after the policy delay.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class VotingHomeScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val hang = FakeApis.Hang()

    @After
    fun releaseHeldRequests() = hang.release()

    private fun text(res: Int): String = RuntimeEnvironment.getApplication().getString(res)

    private val verdict = "Age 20 meets the minimum voting age of 18 in NP."

    private fun launch(api: TranApiClient, settled: Int) {
        compose.setContent { NavigationCoordinator(api = api) }
        awaitNode(hasTestTag(ScreenContract.Eligibility.apiStatus) and hasText(text(settled)))
    }

    private fun awaitNode(matcher: SemanticsMatcher) {
        try {
            compose.waitUntil(TIMEOUT_MS) {
                if (!compose.mainClock.autoAdvance) compose.mainClock.advanceTimeByFrame()
                compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()
            }
        } catch (timeout: ComposeTimeoutException) {
            throw AssertionError("no node ${matcher.description}; screen:\n" + compose.onRoot().printToString(), timeout)
        }
    }

    private fun caption(res: Int) = hasTestTag(ScreenContract.Eligibility.verdictSource) and hasText(text(res))

    private val polite = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)

    private fun noNodes(tag: String) = compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isEmpty()

    // Verifies: REQ-LOAD-002 REQ-LOAD-003
    @Test
    fun `REQ-LOAD-002 a slow confirmation marks the kept verdict as updating only after the delay`() {
        launch(FakeApis.hanging(hang), TranStrings.Shell.statusOnline)
        hang.offMainThread = true
        compose.mainClock.autoAdvance = false

        compose.onNodeWithTag(ScreenContract.Eligibility.checkButton).performClick()
        compose.waitUntil(TIMEOUT_MS) { hang.heldRequests == 1 }
        val delayMs = loadingPolicy().indicatorDelayMs.toLong()
        compose.mainClock.advanceTimeBy(delayMs - BEFORE_DELAY_MS)
        compose.onNodeWithTag(ScreenContract.Eligibility.offlineResult).assertTextEquals(verdict)
        compose.onNodeWithTag(ScreenContract.Eligibility.verdictSource).assertTextEquals(text(TranStrings.Eligibility.resultSourceDevice))

        compose.mainClock.advanceTimeBy(BEFORE_DELAY_MS)
        awaitNode(caption(TranStrings.Eligibility.resultUpdating))
        // REQ-LOAD-003: the device verdict is not blanked; the caption is the announced change.
        compose.onNodeWithTag(ScreenContract.Eligibility.offlineResult).assertTextEquals(verdict)
        compose.onNodeWithTag(ScreenContract.Eligibility.verdictSource).assert(polite)
        assertTrue(noNodes(ScreenContract.Eligibility.toast))
    }

    // Verifies: REQ-LOAD-005 REQ-LOAD-003
    @Test
    fun `REQ-LOAD-005 when the server cannot answer the device decides and says so`() {
        launch(FakeApis.refusing(), TranStrings.Shell.statusOffline)
        awaitNode(hasTestTag(ScreenContract.Eligibility.offlineNotice))

        compose.onNodeWithTag(ScreenContract.Eligibility.checkButton).performClick()
        awaitNode(caption(TranStrings.Eligibility.resultSourceFallback))
        compose.onNodeWithTag(ScreenContract.Eligibility.offlineResult).assertTextEquals(verdict)
        compose.onNodeWithTag(ScreenContract.Eligibility.verdictSource).assert(polite)
        // The banner still applies (REQ-ERR-006); a banner failure never toasts.
        compose.onNodeWithTag(ScreenContract.Eligibility.offlineNotice)
        assertTrue(noNodes(ScreenContract.Eligibility.toast))
    }

    // Verifies: REQ-LOAD-005
    @Test
    fun `REQ-LOAD-005 a server answer labels the verdict as confirmed`() {
        launch(FakeApis.healthy(), TranStrings.Shell.statusOnline)
        compose.onNodeWithTag(ScreenContract.Eligibility.checkButton).performClick()
        awaitNode(caption(TranStrings.Eligibility.resultSourceServer))
        compose.onNodeWithTag(ScreenContract.Eligibility.offlineResult).assertTextEquals(verdict)
    }

    @Test
    fun `the caption appears with a verdict and leaves with invalid input`() {
        launch(FakeApis.healthy(), TranStrings.Shell.statusOnline)
        assertTrue("no verdict, no source", noNodes(ScreenContract.Eligibility.verdictSource))

        compose.onNodeWithTag(ScreenContract.Eligibility.checkButton).performClick()
        awaitNode(hasTestTag(ScreenContract.Eligibility.verdictSource))

        compose.onNodeWithTag(ScreenContract.Eligibility.ageField).performTextReplacement("abc")
        compose.onNodeWithTag(ScreenContract.Eligibility.checkButton).performClick()
        compose.waitForIdle()
        // The refusal has its own element; the result goes back to its placeholder (ADR-0038).
        compose.onNodeWithTag(ScreenContract.Eligibility.validationMessage).assertTextEquals(text(TranStrings.Errors.ageOutOfRange))
        compose.onNodeWithTag(ScreenContract.Eligibility.offlineResult).assertTextEquals(text(TranStrings.Eligibility.resultPlaceholder))
        assertTrue(noNodes(ScreenContract.Eligibility.verdictSource))
    }

    // Verifies: REQ-LOAD-004
    @Test
    fun `REQ-LOAD-004 leaving the screen cancels the confirmation and its late answer is silent`() {
        launch(FakeApis.hanging(hang), TranStrings.Shell.statusOnline)
        hang.offMainThread = true
        compose.onNodeWithTag(ScreenContract.Eligibility.checkButton).performClick()
        compose.waitUntil(TIMEOUT_MS) { hang.heldRequests == 1 }

        compose.onNodeWithTag(ScreenContract.Eligibility.signOutButton).performClick()
        compose.onNodeWithTag(ScreenContract.Eligibility.dialogConfirm).performClick()
        awaitNode(hasTestTag(ScreenContract.AuthWelcome.voterBranchButton))

        // The held request now succeeds; had it survived, it would toast "Server check complete".
        hang.release()
        compose.waitUntil(TIMEOUT_MS) { hang.answeredRequests == 1 }
        compose.waitForIdle()
        assertTrue("a cancelled confirmation shows nothing", noNodes(ScreenContract.Eligibility.toast))
        assertEquals(1, hang.heldRequests)
    }

    companion object {
        private const val TIMEOUT_MS = 15_000L

        /** How far before the policy delay the indicator is checked to be absent. */
        private const val BEFORE_DELAY_MS = 100L

        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }
}
