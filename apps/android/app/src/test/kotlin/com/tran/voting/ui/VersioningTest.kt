// Verifies: REQ-VER-004 REQ-VER-009 REQ-VER-010 REQ-VER-011
package com.tran.voting.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.printToString
import androidx.compose.ui.test.SemanticsMatcher
import android.content.Context
import android.content.Intent
import com.tran.voting.BuildConfig
import com.tran.voting.NavigationCoordinator
import com.tran.voting.api.TranApiClient
import com.tran.voting.generated.ApiContract
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranStrings
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.session.InMemorySessionVault
import com.tran.voting.session.SessionClient
import com.tran.voting.session.StoredSession
import com.tran.voting.testing.FakeApis
import com.tran.voting.update.InMemoryDismissedUpdate
import com.tran.voting.update.UpdatePreferences
import java.util.Collections
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import uniffi.tran_uniffi.TranUserRole

/**
 * Spec 028 through the app's own coordinator on a stubbed API: a `426` blocks the app behind the
 * update screen without touching the session; a recommended update is offered once per version.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class VersioningTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    /** Every request, as "METHOD path". */
    private val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())

    private fun text(res: Int): String = RuntimeEnvironment.getApplication().getString(res)

    private val upgradeRequired = FakeApis.Answer(
        426,
        """{"success":false,"error":"Update","code":"client.upgrade_required","retryable":false}""",
    )

    /** Product routes answer [product] (or a plain 200); health always answers. */
    private fun api(product: (String) -> FakeApis.Answer?): TranApiClient = FakeApis.serving { request ->
        val path = request.url.encodedPath
        calls.add("${request.method} $path")
        if (path == ApiContract.healthPath) null else product(path)
    }

    /** Every answer nudges toward [version] (or names none). */
    private fun nudge(version: String?) = FakeApis.Answer(
        200,
        headers = mapOf(ApiContract.updateHeader to ApiContract.updateRecommended) +
            (version?.let { mapOf(ApiContract.recommendedVersionHeader to it) } ?: emptyMap()),
    )

    private fun await(matcher: SemanticsMatcher) {
        try {
            compose.waitUntil(TIMEOUT_MS) { compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
        } catch (timeout: ComposeTimeoutException) {
            throw AssertionError("no node ${matcher.description}; screen:\n" + compose.onRoot().printToString(), timeout)
        }
    }

    private fun tap(tag: String) {
        await(hasTestTag(tag))
        compose.onNodeWithTag(tag).performClick()
    }

    /** Asks the eligibility question, which sends the one product request of the voter screen. */
    private fun check() {
        await(hasTestTag(ScreenContract.Eligibility.checkButton))
        compose.onNodeWithTag(ScreenContract.Eligibility.ageField).performTextReplacement("20")
        compose.onNodeWithTag(ScreenContract.Eligibility.countryField).performTextReplacement("NP")
        compose.onNodeWithTag(ScreenContract.Eligibility.checkButton).performScrollTo().performClick()
    }

    private fun present(tag: String) = compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()

    /** Waits until the start-up health check and the restore have been answered. */
    private fun settled(requests: Int = 1) {
        compose.waitUntil(TIMEOUT_MS) { calls.size >= requests }
        compose.waitForIdle()
    }

    private fun startedActivity(): Intent? = shadowOf(RuntimeEnvironment.getApplication()).nextStartedActivity

    @Test
    fun `REQ-VER-009 a 426 at launch replaces everything, keeps the stored session and Update opens the store`() {
        val stored = StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, "refresh-one")
        val vault = InMemorySessionVault(stored)
        val api = api { upgradeRequired }
        // As MainActivity builds it: the session client reports to the API client's standing.
        val sessions = SessionClient(vault, baseUrl = "http://api.test", http = api.transport, io = Dispatchers.Unconfined, log = { _, _ -> }, standing = api.standing)
        compose.setContent { NavigationCoordinator(api = api, sessions = sessions) }

        await(hasTestTag(ScreenContract.Eligibility.updateButton))
        await(hasText(text(TranStrings.Errors.updateRequired)))
        await(hasText(text(TranStrings.Errors.updateRequiredBody)))
        assertFalse(present(ScreenContract.Eligibility.checkButton))
        assertFalse(present(ScreenContract.Eligibility.signOutButton))
        assertFalse(present(ScreenContract.AuthWelcome.voterBranchButton))
        // Its one action is the only thing to press.
        assertEquals(1, compose.onAllNodes(hasClickAction()).fetchSemanticsNodes().size)
        assertEquals("the vault is kept", stored, vault.read())
        assertFalse("nothing is revoked", calls.any { it.endsWith("/auth/sign-out") })

        // Back does not leave it.
        compose.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
        compose.activityRule.scenario.onActivity { assertFalse(it.isFinishing) }
        assertTrue(present(ScreenContract.Eligibility.updateButton))

        tap(ScreenContract.Eligibility.updateButton)
        val store = startedActivity()!!
        assertEquals(Intent.ACTION_VIEW, store.action)
        assertEquals(BuildConfig.TRAN_ANDROID_STORE_URL, store.dataString)
        assertTrue(BuildConfig.TRAN_ANDROID_STORE_URL.startsWith("https://"))
    }

    @Test
    fun `REQ-VER-009 a 426 from a call the user made blocks the app, and a later nudge never lifts it`() {
        var blocked = false
        val api = api { path ->
            if (path.endsWith("/account")) {
                blocked = true
                upgradeRequired
            } else if (blocked) nudge("9.0.0") else null
        }
        compose.setContent { NavigationCoordinator(api = api) }

        tap(ScreenContract.Eligibility.deleteAccountButton)
        tap(ScreenContract.Eligibility.deleteAccountConfirm)

        await(hasTestTag(ScreenContract.Eligibility.updateButton))
        assertFalse(present(ScreenContract.Eligibility.deleteAccountConfirm))
        assertFalse(present(ScreenContract.Eligibility.dialogConfirm))
        // A later answer only nudges: still blocked.
        runBlocking { api.confirmEligibility(20, "NP") }
        assertEquals("9.0.0", api.standing.recommendation?.version)
        compose.waitForIdle()
        assertTrue(present(ScreenContract.Eligibility.updateButton))
        assertFalse("no prompt over the blocking screen", present(ScreenContract.Eligibility.dialogConfirm))
    }

    @Test
    fun `REQ-VER-010 a recommended update is offered once and Not now is remembered for that version`() {
        val dismissed = InMemoryDismissedUpdate()
        val api = api { nudge("2.0.0") }
        compose.setContent { NavigationCoordinator(api = api, dismissedUpdate = dismissed) }
        // The start-up health check is not a product route; the eligibility check nudges.
        check()

        await(hasText(text(TranStrings.Shell.updateRecommended)))
        await(hasText(text(TranStrings.Shell.updateRecommendedBody)))
        await(hasText(text(TranStrings.Common.notNow)))
        tap(ScreenContract.Eligibility.dialogCancel)
        assertEquals("2.0.0", dismissed.version)
        assertTrue(present(ScreenContract.Eligibility.checkButton))

        // Another nudged answer for the same version: nothing to ask.
        runBlocking { api.confirmEligibility(20, "NP") }
        compose.waitForIdle()
        assertFalse(present(ScreenContract.Eligibility.dialogConfirm))
    }

    @Test
    fun `REQ-VER-010 a version dismissed before is not asked about again`() {
        val api = api { nudge("2.0.0") }
        compose.setContent { NavigationCoordinator(api = api, dismissedUpdate = InMemoryDismissedUpdate("2.0.0")) }
        check()
        settled(requests = 2)
        assertFalse(present(ScreenContract.Eligibility.dialogConfirm))
    }

    @Test
    fun `REQ-VER-010 a newer recommended version asks again, and Update opens the store`() {
        val dismissed = InMemoryDismissedUpdate("2.0.0")
        var opened = 0
        val api = api { nudge("2.1.0") }
        compose.setContent { NavigationCoordinator(api = api, dismissedUpdate = dismissed, openStore = { opened++ }) }
        check()
        tap(ScreenContract.Eligibility.dialogConfirm)
        assertEquals(1, opened)
        assertEquals("2.0.0", dismissed.version)
        assertNull(startedActivity())
    }

    @Test
    fun `REQ-VER-010 a dismissal is remembered even when the server names no version`() {
        val dismissed = InMemoryDismissedUpdate()
        val api = api { nudge(null) }
        compose.setContent { NavigationCoordinator(api = api, dismissedUpdate = dismissed) }
        check()
        tap(ScreenContract.Eligibility.dialogCancel)
        assertEquals("", dismissed.version)
    }

    @Test
    fun `REQ-VER-010 the dismissed version lives in the app's own preferences`() {
        val context = RuntimeEnvironment.getApplication()
        val preferences = UpdatePreferences(context)
        assertNull(preferences.version)
        preferences.version = "2.0.0"
        assertEquals("2.0.0", UpdatePreferences(context).version)
        assertEquals(
            "2.0.0",
            context.getSharedPreferences(UpdatePreferences.PREFERENCES, Context.MODE_PRIVATE).getString("dismissed_version", null),
        )
    }

    companion object {
        private const val TIMEOUT_MS = 5_000L

        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }
}
