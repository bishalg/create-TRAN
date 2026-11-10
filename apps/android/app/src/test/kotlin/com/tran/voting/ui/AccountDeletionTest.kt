// Verifies: REQ-ACC-004 REQ-ACC-005 REQ-ACC-006 REQ-ROB-007
package com.tran.voting.ui

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
import com.tran.voting.api.TranApiClient
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranStrings
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.session.InMemorySessionVault
import com.tran.voting.session.SessionClient
import com.tran.voting.session.StoredSession
import com.tran.voting.testing.FakeApis
import java.io.IOException
import java.util.Collections
import kotlinx.coroutines.Dispatchers
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Before
import org.robolectric.shadows.ShadowLog
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
import uniffi.tran_uniffi.TranUserRole

/**
 * Deleting the account through the app's own coordinator, on a stubbed API (hermetic, ADR-0023).
 * "Confirming deletes the account and returns to role selection" is not a contract scenario: the
 * native suites have no API that confirms a deletion (spec 024, REQ-ACC-005), so it is proven here.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AccountDeletionTest {
    @get:Rule
    val compose = createComposeRule()

    private val stored = StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, "refresh-one")
    private val vault = InMemorySessionVault(stored)

    /** Every request the session client sent, as "METHOD path". */
    private val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())

    /** What `DELETE /api/v1/account` answers. */
    private var deletion = 204

    /** What `POST /api/v1/auth/refresh` answers. */
    private var refresh = 200

    /** When set, the deletion waits for [FakeApis.Hang.release] off the main thread. */
    private var hang: FakeApis.Hang? = null

    @Before
    fun clearLog() = ShadowLog.clear()

    @After
    fun releaseHeldRequests() {
        hang?.release()
    }

    /** The `request failed` events written by the app's one logcat writer (REQ-ROB-007). */
    private fun failureEvents(): List<String> =
        ShadowLog.getLogsForTag("TranFeedback").map { it.msg }.filter { it.startsWith("request failed") }

    private fun text(res: Int): String = RuntimeEnvironment.getApplication().getString(res)

    private fun answer(request: Request, code: Int, body: String = ""): Response = Response.Builder()
        .request(request)
        .protocol(Protocol.HTTP_1_1)
        .code(code)
        .message("stub")
        .body(body.toResponseBody("application/json".toMediaType()))
        .build()

    /** After a restart: the refresh brings an access token, then the deletion answers [deletion]. */
    private fun sessions() = SessionClient(
        vault = vault,
        baseUrl = "http://api.test",
        http = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            calls.add("${request.method} ${request.url.encodedPath}")
            when (request.url.encodedPath) {
                "/api/v1/auth/refresh" -> if (refresh != 200) {
                    answer(request, refresh, """{"success":false,"error":"Failed"}""")
                } else answer(
                    request,
                    200,
                    """{"access_token":"access-two","token_type":"Bearer","expires_in":900,"refresh_token":"refresh-two",""" +
                        """"user":{"user_id":"voter-001","role":"citizen_voter"}}""",
                )
                "/api/v1/account" -> answer(request, deletion.also { hang?.let(::hold) }, if (deletion == 204) "" else """{"success":false,"error":"Failed"}""")
                else -> answer(request, 200, """{"user_id":"voter-001","role":"citizen_voter"}""")
            }
        }.build(),
        io = hang?.dispatcher ?: Dispatchers.Unconfined,
    )

    private fun hold(hang: FakeApis.Hang) {
        hang.held.incrementAndGet()
        hang.latch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
    }

    private fun awaitNode(matcher: SemanticsMatcher) {
        try {
            compose.waitUntil(TIMEOUT_MS) { compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
        } catch (timeout: ComposeTimeoutException) {
            throw AssertionError("no node ${matcher.description}; screen:\n" + compose.onRoot().printToString(), timeout)
        }
    }

    private fun tap(tag: String) {
        awaitNode(hasTestTag(tag))
        compose.onNodeWithTag(tag).performClick()
    }

    private fun none(tag: String) = compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isEmpty()

    private fun deletes() = calls.count { it == "DELETE /api/v1/account" }

    @Test
    fun `REQ-ACC-006 confirming deletes the account and returns to role selection`() {
        val sessions = sessions()
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy(), sessions = sessions) }

        tap(ScreenContract.Eligibility.deleteAccountButton)
        tap(ScreenContract.Eligibility.deleteAccountConfirm)

        awaitNode(hasTestTag(ScreenContract.AuthWelcome.voterBranchButton))
        awaitNode(hasText(text(TranStrings.Auth.accountDeleted)))
        assertEquals(1, deletes())
        assertNull("the vault is cleared after the 204", vault.read())
        assertTrue(!sessions.hasAccessToken)
    }

    @Test
    fun `REQ-ACC-006 the auditor deletes the account the same way`() {
        val sessions = sessions()
        compose.setContent {
            NavigationCoordinator(
                api = FakeApis.healthy(),
                initialSession = AuthSession.Authenticated("auditor-001", TranUserRole.ELECTION_AUDITOR),
                sessions = sessions,
            )
        }

        tap(ScreenContract.Auditor.deleteAccountButton)
        tap(ScreenContract.Auditor.deleteAccountConfirm)

        awaitNode(hasTestTag(ScreenContract.AuthWelcome.voterBranchButton))
        assertEquals(1, deletes())
        assertNull(vault.read())
    }

    @Test
    fun `REQ-ACC-005 Cancel sends nothing and keeps the session`() {
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy(), sessions = sessions()) }

        tap(ScreenContract.Eligibility.deleteAccountButton)
        tap(ScreenContract.Eligibility.deleteAccountCancel)

        compose.waitUntil(TIMEOUT_MS) { none(ScreenContract.Eligibility.deleteAccountConfirm) }
        awaitNode(hasTestTag(ScreenContract.Eligibility.checkButton))
        assertEquals(0, deletes())
        assertEquals("voter-001", vault.read()?.userId)
    }

    @Test
    fun `REQ-ACC-006 a server failure keeps the account and says so`() {
        deletion = 500
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy(), sessions = sessions()) }

        tap(ScreenContract.Eligibility.deleteAccountButton)
        tap(ScreenContract.Eligibility.deleteAccountConfirm)

        awaitNode(hasText(text(TranStrings.Errors.serverInternal)))
        assertEquals(1, deletes())
        assertTrue(none(ScreenContract.AuthWelcome.voterBranchButton))
        awaitNode(hasTestTag(ScreenContract.Eligibility.deleteAccountButton))
        assertEquals("voter-001", vault.read()?.userId)
        // Usable again after a failure.
        compose.onNodeWithTag(ScreenContract.Eligibility.deleteAccountButton).assertIsEnabled()
        // REQ-ROB-007: one failure, one event, whoever caught it on the way.
        assertEquals(listOf("request failed code=server.internal status=500 request_id=-"), failureEvents())
    }

    @Test
    fun `REQ-ACC-006 the control is disabled while a deletion is in flight`() {
        val held = FakeApis.Hang().also { hang = it }
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy(), sessions = sessions()) }
        awaitNode(hasTestTag(ScreenContract.Eligibility.deleteAccountButton))
        compose.waitForIdle()
        held.offMainThread = true

        tap(ScreenContract.Eligibility.deleteAccountButton)
        tap(ScreenContract.Eligibility.deleteAccountConfirm)

        compose.waitUntil(TIMEOUT_MS) { held.heldRequests == 1 }
        compose.onNodeWithTag(ScreenContract.Eligibility.deleteAccountButton).assertIsNotEnabled()
        compose.onNodeWithTag(ScreenContract.Eligibility.deleteAccountButton).performClick()
        compose.waitForIdle()
        assertTrue("a second tap opens no dialog", none(ScreenContract.Eligibility.deleteAccountConfirm))
        assertEquals(1, deletes())
    }

    @Test
    fun `REQ-ROB-007 a restored session the API cannot check logs one event`() {
        refresh = 503
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy(), sessions = sessions()) }

        compose.waitUntil(TIMEOUT_MS) { failureEvents().isNotEmpty() }
        compose.waitForIdle()
        assertEquals(listOf("request failed code=server.unavailable status=503 request_id=-"), failureEvents())
    }

    @Test
    fun `REQ-ROB-007 a restored session the API ended logs one event`() {
        refresh = 401
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy(), sessions = sessions()) }

        awaitNode(hasTestTag(ScreenContract.Eligibility.dialogConfirm))
        compose.waitForIdle()
        assertEquals(1, failureEvents().count { it.contains("code=auth.session_expired") })
        assertEquals(1, failureEvents().size)
    }

    @Test
    fun `REQ-ACC-006 a device-only session still asks the server and an unreachable one keeps it`() {
        // The screen contract's preset: no session client, so no token. The request still goes out on
        // the API's transport and fails as a network error, never as a sign-out. Health answers, so
        // the banner can only come from the deletion.
        val api = TranApiClient(
            baseUrl = "http://api.test",
            includeDebugCountry = false,
            http = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request()
                calls.add("${request.method} ${request.url.encodedPath}")
                if (request.url.encodedPath == "/api/v1/account") throw IOException("connection refused")
                answer(request, 200, "{}")
            }.build(),
            io = Dispatchers.Unconfined,
        )
        compose.setContent { NavigationCoordinator(api = api) }
        awaitNode(hasTestTag(ScreenContract.Eligibility.apiStatus) and hasText(text(TranStrings.Shell.statusOnline)))
        assertTrue(none(ScreenContract.Eligibility.offlineNotice))

        tap(ScreenContract.Eligibility.deleteAccountButton)
        tap(ScreenContract.Eligibility.deleteAccountConfirm)

        awaitNode(hasTestTag(ScreenContract.Eligibility.offlineNotice))
        assertEquals(1, deletes())
        assertTrue(none(ScreenContract.AuthWelcome.voterBranchButton))
        assertTrue("no session-expired dialog", none(ScreenContract.Eligibility.dialogConfirm))
        awaitNode(hasTestTag(ScreenContract.Eligibility.deleteAccountButton))
    }

    companion object {
        private const val TIMEOUT_MS = 5_000L

        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }
}
