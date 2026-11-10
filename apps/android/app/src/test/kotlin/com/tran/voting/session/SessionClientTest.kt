// Verifies: REQ-SEC-014 REQ-SEC-016 REQ-SEC-017 REQ-SEC-022 REQ-ACC-006
package com.tran.voting.session

import com.tran.voting.api.TranRequestFailure
import com.tran.voting.parity.VoteEligibilityParityTest
import java.util.Collections
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranUserRole
import uniffi.tran_uniffi.errorSpec

/** The Android session client on a stubbed API (hermetic, ADR-0023): body transport, bearer, refresh, sign-out. */
class SessionClientTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private const val ACCESS_1 = "access-one-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        private const val REFRESH_1 = "refresh-one-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
        private const val ACCESS_2 = "access-two-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
        private const val REFRESH_2 = "refresh-two-DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
        private val TOKENS = listOf(ACCESS_1, REFRESH_1, ACCESS_2, REFRESH_2)
    }

    private lateinit var server: MockWebServer
    private val vault = InMemorySessionVault()
    private val logLines: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val refreshes = AtomicInteger()

    /** What the stub answers; tests replace parts of it. */
    private var refreshAnswer: () -> MockResponse = { pair(ACCESS_2, REFRESH_2, 200) }
    private var validAccess = setOf(ACCESS_2)
    private var signOutHook: (RecordedRequest) -> Unit = {}
    private var accountAnswer: () -> MockResponse = { MockResponse().setResponseCode(204) }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
                "/api/v1/auth/session" -> if (request.method == "POST") {
                    pair(ACCESS_1, REFRESH_1, 201)
                } else {
                    val bearer = request.getHeader("Authorization")?.removePrefix("Bearer ")
                    if (bearer in validAccess) json(200, """{"user_id":"voter-001","role":"citizen_voter"}""") else expired()
                }
                "/api/v1/auth/refresh" -> {
                    refreshes.incrementAndGet()
                    refreshAnswer()
                }
                "/api/v1/auth/sign-out" -> {
                    signOutHook(request)
                    MockResponse().setResponseCode(204)
                }
                "/api/v1/account" -> {
                    val bearer = request.getHeader("Authorization")?.removePrefix("Bearer ")
                    if (request.method == "DELETE" && bearer in validAccess) accountAnswer() else expired()
                }
                else -> MockResponse().setResponseCode(404)
            }
        }
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun client() = SessionClient(
        vault = vault,
        baseUrl = server.url("/").toString(),
        log = { _: TranLogLevel, line: String -> logLines.add(line) },
    )

    private fun json(status: Int, body: String) =
        MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json").setBody(body)

    private fun pair(access: String, refresh: String, status: Int) = json(
        status,
        """{"access_token":"$access","token_type":"Bearer","expires_in":900,"refresh_token":"$refresh",""" +
            """"user":{"user_id":"voter-001","role":"citizen_voter"}}""",
    )

    private fun expired() = json(401, """{"success":false,"error":"Session expired","code":"auth.session_expired"}""")
        .setHeader("WWW-Authenticate", "Bearer")

    private fun requests(): List<RecordedRequest> = (0 until server.requestCount).map { server.takeRequest(1, TimeUnit.SECONDS)!! }

    private suspend fun failureOf(call: suspend () -> Unit): TranRequestFailure = try {
        call()
        throw AssertionError("expected a failure")
    } catch (failure: TranRequestFailure) {
        failure
    }

    /** REQ-SEC-014: no token in any log line, failure message or printed record. */
    private fun assertNothingLeaked(vararg extra: Any?) {
        val printed = logLines + extra.map { it.toString() }
        for (token in TOKENS) {
            for (line in printed) assertFalse("token leaked into \"$line\"", line.contains(token))
        }
    }

    @Test
    fun signInUsesTheBodyTransportAndKeepsOnlyTheRefreshTokenInTheVault() = runBlocking {
        val client = client()
        val user = client.signIn(TranUserRole.CITIZEN_VOTER)

        assertEquals(SessionUser("voter-001", TranUserRole.CITIZEN_VOTER), user)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/auth/session", request.path)
        val body = JSONObject(request.body.readUtf8())
        assertEquals("citizen_voter", body.getString("role"))
        assertEquals("body", body.getString("transport"))
        // REQ-SEC-017: the vault holds the refresh token, the access token stays in memory.
        assertEquals(StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, REFRESH_1), vault.read())
        assertTrue(client.hasAccessToken)
        assertNothingLeaked(vault.read())
    }

    @Test
    fun callsCarryTheBearerTokenAndNoTokenInTheUrl() = runBlocking {
        validAccess = setOf(ACCESS_1)
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)
        assertEquals(SessionUser("voter-001", TranUserRole.CITIZEN_VOTER), client.currentUser())

        val calls = requests()
        assertEquals("Bearer $ACCESS_1", calls.last().getHeader("Authorization"))
        assertEquals(0, refreshes.get())
        for (call in calls) for (token in TOKENS) assertFalse(call.path!!.contains(token))
    }

    @Test
    fun afterARestartTheClientRefreshesBeforeItsFirstCall() = runBlocking {
        vault.write(StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, REFRESH_1))
        val client = client()
        assertFalse(client.hasAccessToken)

        client.currentUser()

        val calls = requests()
        assertEquals(listOf("/api/v1/auth/refresh", "/api/v1/auth/session"), calls.map { it.path })
        assertEquals(REFRESH_1, JSONObject(calls[0].body.readUtf8()).getString("refresh_token"))
        assertEquals("Bearer $ACCESS_2", calls[1].getHeader("Authorization"))
        assertEquals(REFRESH_2, vault.read()?.refreshToken)
    }

    @Test
    fun concurrentUnauthorizedCallsShareOneRefreshAndRepeatOnce() = runBlocking {
        // REQ-SEC-016: the refresh answers slowly, so every 401 arrives while it is in flight.
        refreshAnswer = { pair(ACCESS_2, REFRESH_2, 200).setHeadersDelay(300, TimeUnit.MILLISECONDS) }
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)

        val users = (1..4).map { async(Dispatchers.IO) { client.currentUser() } }.awaitAll()

        assertEquals(4, users.size)
        assertEquals(1, refreshes.get())
        val sessionCalls = requests().filter { it.path == "/api/v1/auth/session" && it.method == "GET" }
        assertEquals(4, sessionCalls.count { it.getHeader("Authorization") == "Bearer $ACCESS_1" })
        assertEquals(4, sessionCalls.count { it.getHeader("Authorization") == "Bearer $ACCESS_2" })
    }

    @Test
    fun aRejectedRefreshSignsOutAndClearsTheDevice() = runBlocking {
        refreshAnswer = { expired() }
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)

        val failure = failureOf { client.currentUser() }

        assertEquals(TranErrorCode.AUTH_SESSION_EXPIRED, failure.code)
        assertNull(vault.read())
        assertFalse(client.hasAccessToken)
        assertEquals(1, refreshes.get())
        assertNothingLeaked(failure, failure.message)
    }

    @Test
    fun aFailedRefreshKeepsTheSession() = runBlocking {
        for (status in listOf(429, 500, 503)) {
            refreshAnswer = { json(status, """{"success":false,"error":"Unavailable"}""") }
            vault.write(StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, REFRESH_1))

            val failure = failureOf { client().currentUser() }

            assertNotEquals("status $status", TranErrorCode.AUTH_SESSION_EXPIRED, failure.code)
            assertEquals("status $status", status, failure.status)
            assertEquals("status $status", REFRESH_1, vault.read()?.refreshToken)
        }
        assertNothingLeaked()
    }

    @Test
    fun anUnreachableApiKeepsTheSession() = runBlocking {
        vault.write(StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, REFRESH_1))
        val client = client()
        server.shutdown()

        val failure = failureOf { client.currentUser() }

        assertNotEquals(TranErrorCode.AUTH_SESSION_EXPIRED, failure.code)
        assertNull(failure.status)
        assertEquals(REFRESH_1, vault.read()?.refreshToken)
        assertNothingLeaked(failure)
    }

    @Test
    fun aSecond401AfterTheRetrySignsOut() = runBlocking {
        validAccess = emptySet()
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)

        val failure = failureOf { client.currentUser() }

        assertEquals(TranErrorCode.AUTH_SESSION_EXPIRED, failure.code)
        assertEquals(1, refreshes.get())
        assertNull(vault.read())
        assertFalse(client.hasAccessToken)
    }

    @Test
    fun noCredentialSignsOutWithoutTouchingTheNetwork() = runBlocking {
        val failure = failureOf { client().currentUser() }

        assertEquals(TranErrorCode.AUTH_SESSION_EXPIRED, failure.code)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun signOutClearsTheDeviceBeforeTheServerCall() = runBlocking {
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)
        var vaultAtCall: StoredSession? = StoredSession("sentinel", TranUserRole.CITIZEN_VOTER, "sentinel")
        var accessAtCall = true
        signOutHook = {
            vaultAtCall = vault.read()
            accessAtCall = client.hasAccessToken
        }

        client.signOut()

        val call = requests().last()
        assertEquals("/api/v1/auth/sign-out", call.path)
        assertEquals(REFRESH_1, JSONObject(call.body.readUtf8()).getString("refresh_token"))
        assertNull(vaultAtCall)
        assertFalse(accessAtCall)
        assertNull(vault.read())
        assertFalse(client.hasAccessToken)
    }

    @Test
    fun signOutSucceedsOnTheDeviceWhenTheServerIsUnreachable() = runBlocking {
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)
        server.shutdown()

        try {
            client.signOut()
        } catch (error: Throwable) {
            fail("sign-out must not fail on the network: $error")
        }

        assertNull(vault.read())
        assertFalse(client.hasAccessToken)
        assertTrue("the failed call is logged", logLines.isNotEmpty())
        assertNothingLeaked()
    }

    // Account deletion (REQ-ACC-006): the server decides, then the device follows.

    @Test
    fun deletionSendsTheBearerAndClearsTheDeviceOnlyAfterTheServerConfirms() = runBlocking {
        validAccess = setOf(ACCESS_1)
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)
        var vaultAtAnswer: StoredSession? = null
        accountAnswer = {
            vaultAtAnswer = vault.read()
            MockResponse().setResponseCode(204)
        }

        client.deleteAccount()

        val call = requests().last()
        assertEquals("DELETE", call.method)
        assertEquals("/api/v1/account", call.path)
        assertEquals("Bearer $ACCESS_1", call.getHeader("Authorization"))
        assertEquals(0L, call.bodySize)
        assertEquals("the device keeps the session until the server answers", REFRESH_1, vaultAtAnswer?.refreshToken)
        assertNull(vault.read())
        assertFalse(client.hasAccessToken)
        assertNothingLeaked()
    }

    @Test
    fun concurrentDeletionsSendOneRequestAndShareItsAnswer() = runBlocking {
        // REQ-ACC-006: a second activation while one is in flight must not send another DELETE,
        // whose 401 would raise a misleading session-expired dialog.
        validAccess = setOf(ACCESS_1)
        accountAnswer = { MockResponse().setResponseCode(204).setHeadersDelay(300, TimeUnit.MILLISECONDS) }
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)

        (1..2).map { async(Dispatchers.IO) { client.deleteAccount() } }.awaitAll()

        assertEquals(1, requests().count { it.path == "/api/v1/account" })
        assertNull(vault.read())
    }

    @Test
    fun aDeletionAfterAFailedOneAsksAgain() = runBlocking {
        validAccess = setOf(ACCESS_1)
        accountAnswer = { json(500, """{"success":false,"error":"Failed"}""") }
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)
        failureOf { client.deleteAccount() }

        accountAnswer = { MockResponse().setResponseCode(204) }
        client.deleteAccount()

        assertEquals(2, requests().count { it.path == "/api/v1/account" })
        assertNull(vault.read())
    }

    @Test
    fun aThrownFailureIsTheCallersToLog() = runBlocking {
        // REQ-ROB-007: the caller presents and logs what it is thrown, so the client must not log it
        // as well; only a failure it swallows (sign-out's revoke) is logged here.
        validAccess = setOf(ACCESS_1)
        accountAnswer = { json(500, """{"success":false,"error":"Failed"}""") }
        refreshAnswer = { expired() }
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)

        failureOf { client.deleteAccount() }
        validAccess = emptySet()
        failureOf { client.currentUser() }

        assertEquals(emptyList<String>(), logLines)
    }

    @Test
    fun aDeletionTheServerRefusesKeepsTheSession() = runBlocking {
        validAccess = setOf(ACCESS_1)
        val expected = mapOf(500 to TranErrorCode.SERVER_INTERNAL, 503 to TranErrorCode.SERVER_UNAVAILABLE)
        for ((status, code) in expected) {
            accountAnswer = { json(status, """{"success":false,"error":"Failed","code":"${errorSpec(code).wireCode}"}""") }
            val client = client()
            client.signIn(TranUserRole.CITIZEN_VOTER)

            val failure = failureOf { client.deleteAccount() }

            assertEquals("status $status", code, failure.code)
            assertEquals("status $status", REFRESH_1, vault.read()?.refreshToken)
            assertTrue("status $status", client.hasAccessToken)
        }
        assertNothingLeaked()
    }

    @Test
    fun aDeletionThatCannotReachTheServerKeepsTheSession() = runBlocking {
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)
        server.shutdown()

        val failure = failureOf { client.deleteAccount() }

        assertNotEquals(TranErrorCode.AUTH_SESSION_EXPIRED, failure.code)
        assertNull(failure.status)
        assertEquals(REFRESH_1, vault.read()?.refreshToken)
        assertTrue(client.hasAccessToken)
    }

    @Test
    fun aDeletionWithAnExpiredAccessTokenRefreshesAndRepeatsOnce() = runBlocking {
        // REQ-SEC-015: ACCESS_1 is refused; the refresh brings ACCESS_2, which the server accepts.
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)

        client.deleteAccount()

        val deletes = requests().filter { it.path == "/api/v1/account" }
        assertEquals(listOf("Bearer $ACCESS_1", "Bearer $ACCESS_2"), deletes.map { it.getHeader("Authorization") })
        assertEquals(1, refreshes.get())
        assertNull(vault.read())
        assertFalse(client.hasAccessToken)
    }

    @Test
    fun aDeletionWhoseRefreshIsRejectedSignsOut() = runBlocking {
        refreshAnswer = { expired() }
        val client = client()
        client.signIn(TranUserRole.CITIZEN_VOTER)

        val failure = failureOf { client.deleteAccount() }

        assertEquals(TranErrorCode.AUTH_SESSION_EXPIRED, failure.code)
        assertNull(vault.read())
        assertFalse(client.hasAccessToken)
    }

    @Test
    fun withoutAnyCredentialTheDeletionStillAsksTheServer() = runBlocking {
        // A device session whose API sign-in never landed: "no token" is not "signed out" until the
        // server says so, so an unreachable server keeps the user where they are.
        val failure = failureOf { client().deleteAccount() }

        val call = requests().single()
        assertEquals("/api/v1/account", call.path)
        assertNull(call.getHeader("Authorization"))
        assertEquals(TranErrorCode.AUTH_SESSION_EXPIRED, failure.code)

        server.shutdown()
        val offline = failureOf { client().deleteAccount() }
        assertNotEquals(TranErrorCode.AUTH_SESSION_EXPIRED, offline.code)
        assertNull(offline.status)
    }

    @Test
    fun aStoredRecordNeverPrintsItsToken() {
        val record = StoredSession("voter-001", TranUserRole.ELECTION_AUDITOR, REFRESH_1)
        assertEquals("StoredSession(userId=voter-001, role=election_auditor, refreshToken=[redacted])", record.toString())
    }
}
