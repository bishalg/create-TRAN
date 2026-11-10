// Verifies: REQ-SEC-021
package com.tran.voting.session

import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.printToString
import com.tran.voting.NavigationCoordinator
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranStrings
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.testing.FakeApis
import com.tran.voting.ui.AuthSession
import com.tran.voting.ui.destination
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uniffi.tran_uniffi.TranAppDestination
import uniffi.tran_uniffi.TranUserRole

/**
 * Launch restores the vault's session without the network, then checks it in the background
 * (REQ-SEC-021, ADR-0039 decision 7). Robolectric, with a fake transport that answers on the
 * calling thread (docs/LEARNINGS.md, 2026-10-21).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SessionRestoreTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private const val TIMEOUT_MS = 5_000L
        private val stored = StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, "refresh-stored")
    }

    @get:Rule
    val compose = createComposeRule()

    private val calls = AtomicInteger()

    /** A session client whose transport answers each path with [answer] (`null` = no answer at all). */
    private fun client(vault: SessionVault, answer: (String) -> Pair<Int, String>?): SessionClient {
        val http = OkHttpClient.Builder().addInterceptor(
            Interceptor { chain ->
                calls.incrementAndGet()
                val (status, body) = answer(chain.request().url.encodedPath) ?: throw IOException("unreachable")
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(status)
                    .message("stub")
                    .body(body.toResponseBody("application/json".toMediaType()))
                    .build()
            },
        ).build()
        return SessionClient(vault, baseUrl = "http://api.test", http = http, io = Dispatchers.Unconfined, log = { _, _ -> })
    }

    private val pair =
        """{"access_token":"access-new","token_type":"Bearer","expires_in":900,"refresh_token":"refresh-new",""" +
            """"user":{"user_id":"voter-001","role":"citizen_voter"}}"""
    private val expired = """{"success":false,"error":"Session expired","code":"auth.session_expired"}"""

    private fun healthyApi(path: String): Pair<Int, String> = when (path) {
        "/api/v1/auth/refresh" -> 200 to pair
        "/api/v1/auth/session" -> 201 to pair
        else -> 200 to "{}"
    }

    private fun text(res: Int): String = RuntimeEnvironment.getApplication().getString(res)

    private fun await(matcher: SemanticsMatcher) {
        try {
            compose.waitUntil(TIMEOUT_MS) { compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
        } catch (timeout: ComposeTimeoutException) {
            throw AssertionError("no node ${matcher.description}; screen:\n" + compose.onRoot().printToString(), timeout)
        }
    }

    private fun present(tag: String) = compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun `the stored session decides the first screen with no network`() {
        val sessions = client(InMemorySessionVault(stored)) { null }
        val restored = restoredSession(InMemorySessionVault(stored))

        assertEquals(AuthSession.Authenticated("voter-001", TranUserRole.CITIZEN_VOTER), restored)
        assertEquals(TranAppDestination.VOTER_DASHBOARD, restored.destination)
        assertEquals(TranAppDestination.AUTH_WELCOME, restoredSession(InMemorySessionVault()).destination)
        assertEquals(0, calls.get())
        assertTrue(sessions.hasAccessToken.not())
    }

    @Test
    fun `validation refreshes and confirms a live session`() = runBlocking {
        val vault = InMemorySessionVault(stored)
        assertEquals(RestoreOutcome.VALID, validateRestoredSession(client(vault) { 200 to if (it.endsWith("refresh")) pair else """{"user_id":"voter-001","role":"citizen_voter"}""" }))
        assertEquals("refresh-new", vault.read()?.refreshToken)
    }

    @Test
    fun `a rejected refresh signs out and clears the vault`() = runBlocking {
        val vault = InMemorySessionVault(stored)
        assertEquals(RestoreOutcome.SIGNED_OUT, validateRestoredSession(client(vault) { 401 to expired }))
        assertNull(vault.read())
    }

    @Test
    fun `an unreachable or failing API never signs the user out`() = runBlocking {
        for (answer in listOf<(String) -> Pair<Int, String>?>({ null }, { 503 to "{}" }, { 500 to "{}" })) {
            val vault = InMemorySessionVault(stored)
            assertEquals(RestoreOutcome.KEPT, validateRestoredSession(client(vault, answer)))
            assertEquals(stored, vault.read())
        }
    }

    @Test
    fun `a dead session at launch opens the session-expired dialog, and signing in again leads to welcome`() {
        val vault = InMemorySessionVault(stored)
        val sessions = client(vault) { 401 to expired }
        compose.setContent {
            NavigationCoordinator(api = FakeApis.healthy(), initialSession = restoredSession(vault), sessions = sessions)
        }

        await(hasText(text(TranStrings.Errors.sessionExpiredBody)))
        assertNull(vault.read())
        compose.onNodeWithTag(ScreenContract.Eligibility.dialogConfirm).performClick()
        await(hasTestTag(ScreenContract.AuthWelcome.voterBranchButton))
    }

    @Test
    fun `an unreachable API at launch keeps the dashboard and the vault`() {
        val vault = InMemorySessionVault(stored)
        val sessions = client(vault) { null }
        compose.setContent {
            NavigationCoordinator(api = FakeApis.refusing(), initialSession = restoredSession(vault), sessions = sessions)
        }

        await(hasTestTag(ScreenContract.Eligibility.ageField))
        compose.waitUntil(TIMEOUT_MS) { calls.get() > 0 }
        compose.waitForIdle()
        assertTrue(present(ScreenContract.Eligibility.ageField))
        assertTrue(!present(ScreenContract.Eligibility.dialogConfirm))
        assertEquals(stored, vault.read())
    }

    @Test
    fun `choosing a role signs in on the device at once and stores the API session behind it`() {
        val vault = InMemorySessionVault()
        val sessions = client(vault, ::healthyApi)
        compose.setContent {
            NavigationCoordinator(api = FakeApis.healthy(), initialSession = AuthSession.Unauthenticated, sessions = sessions)
        }

        compose.onNodeWithTag(ScreenContract.AuthWelcome.voterBranchButton).performClick()
        await(hasTestTag(ScreenContract.Eligibility.ageField))
        compose.waitUntil(TIMEOUT_MS) { vault.read() != null }
        assertEquals(StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, "refresh-new"), vault.read())
    }

    @Test
    fun `choosing a role offline still signs in on the device`() {
        val vault = InMemorySessionVault()
        val sessions = client(vault) { null }
        compose.setContent {
            NavigationCoordinator(api = FakeApis.refusing(), initialSession = AuthSession.Unauthenticated, sessions = sessions)
        }

        compose.onNodeWithTag(ScreenContract.AuthWelcome.auditorBranchButton).performClick()
        await(hasTestTag(ScreenContract.Auditor.signOutButton))
        compose.waitUntil(TIMEOUT_MS) { calls.get() > 0 }
        assertNull(vault.read())
    }

    // Verifies: REQ-SEC-022
    @Test
    fun `signing out clears the vault even when the server cannot be reached`() {
        val vault = InMemorySessionVault(stored)
        val sessions = client(vault) { null }
        compose.setContent {
            NavigationCoordinator(api = FakeApis.refusing(), initialSession = restoredSession(vault), sessions = sessions)
        }

        compose.onNodeWithTag(ScreenContract.Eligibility.signOutButton).performClick()
        compose.onNodeWithTag(ScreenContract.Eligibility.dialogConfirm).performClick()
        await(hasTestTag(ScreenContract.AuthWelcome.voterBranchButton))
        assertNull(vault.read())
    }
}
