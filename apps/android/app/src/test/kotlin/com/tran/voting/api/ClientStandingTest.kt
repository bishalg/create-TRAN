// Verifies: REQ-VER-004 REQ-VER-009 REQ-VER-010
package com.tran.voting.api

import com.tran.voting.BuildConfig
import com.tran.voting.generated.ApiContract
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.session.InMemorySessionVault
import com.tran.voting.session.SessionClient
import com.tran.voting.session.StoredSession
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranClientPlatform
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranUserRole
import uniffi.tran_uniffi.parseClient

/** The client names itself on every request and reads what the answers say about its version (spec 028). */
class ClientStandingTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private val instant = TranRetry(sleep = {}, random = { 0.0 })
    }

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() = server.shutdown()

    private fun api() = TranApiClient(baseUrl = server.url("/").toString(), includeDebugCountry = false, retry = instant)

    private fun ok(code: Int = 200, body: String = "{}") = MockResponse().setResponseCode(code).setBody(body)

    private fun nudge(version: String?) = ok().addHeader(ApiContract.updateHeader, ApiContract.updateRecommended).apply {
        version?.let { addHeader(ApiContract.recommendedVersionHeader, it) }
    }

    private val upgradeRequired = ok(426, """{"success":false,"error":"Update","code":"client.upgrade_required"}""")

    @Test
    fun `REQ-VER-004 the header is the Rust formatter over versionName`() {
        assertEquals("android/${BuildConfig.VERSION_NAME}", TranClientIdentity.header)
        val parsed = parseClient(TranClientIdentity.header)
        assertEquals(TranClientPlatform.ANDROID, parsed.platform)
        assertEquals(BuildConfig.VERSION_NAME, parsed.version)
    }

    @Test
    fun `REQ-VER-004 every request of both clients names the app`() = runBlocking {
        val api = api()
        val sessions = SessionClient(
            InMemorySessionVault(StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, "refresh-one")),
            baseUrl = server.url("/").toString(),
            log = { _, _ -> },
            standing = api.standing,
        )
        repeat(2) { server.enqueue(ok()) }
        api.checkHealth()
        api.confirmEligibility(20, "NP")
        server.enqueue(ok(204, ""))
        sessions.signOut()
        // A device-only session's deletion goes out the same way.
        server.enqueue(ok(204, ""))
        SessionClient.deviceOnly(api).deleteAccount()
        repeat(4) {
            assertEquals("android/${BuildConfig.VERSION_NAME}", server.takeRequest().getHeader(ApiContract.clientHeader))
        }
    }

    @Test
    fun `REQ-VER-009 a 426 from a product route blocks for good, and is the catalogue's code`() = runBlocking {
        val api = api()
        server.enqueue(upgradeRequired)
        val failure = try {
            api.confirmEligibility(20, "NP")
            null
        } catch (failure: TranRequestFailure) {
            failure
        }
        assertEquals(TranErrorCode.CLIENT_UPGRADE_REQUIRED, failure?.code)
        assertEquals(1, server.requestCount)
        assertTrue(api.standing.upgradeRequired)

        // A later nudge is still read, but nothing lifts the block.
        server.enqueue(nudge("9.0.0"))
        api.confirmEligibility(20, "NP")
        assertTrue(api.standing.upgradeRequired)
        assertEquals(UpdateRecommendation("9.0.0"), api.standing.recommendation)
    }

    @Test
    fun `REQ-VER-009 health is unversioned and never blocks`() = runBlocking {
        val api = api()
        server.enqueue(upgradeRequired)
        runCatching { api.probeHealth() }
        assertFalse(api.standing.upgradeRequired)
    }

    @Test
    fun `REQ-VER-010 a nudge records the recommended version, which changes only with the version`() = runBlocking {
        val api = api()
        server.enqueue(ok())
        api.confirmEligibility(20, "NP")
        assertNull("no header, no recommendation", api.standing.recommendation)

        server.enqueue(nudge("2.0.0"))
        api.confirmEligibility(20, "NP")
        val first = api.standing.recommendation
        assertEquals(UpdateRecommendation("2.0.0"), first)
        server.enqueue(nudge("2.0.0"))
        api.confirmEligibility(20, "NP")
        assertTrue("the same version is the same signal", first === api.standing.recommendation)

        server.enqueue(nudge(null))
        api.confirmEligibility(20, "NP")
        assertEquals(UpdateRecommendation(null), api.standing.recommendation)
        assertFalse(api.standing.upgradeRequired)
    }

    @Test
    fun `REQ-VER-010 a session answer reports to the standing it was given`() = runBlocking {
        val api = api()
        val sessions = SessionClient(InMemorySessionVault(), baseUrl = server.url("/").toString(), log = { _, _ -> }, standing = api.standing)
        server.enqueue(
            nudge("3.0.0").setResponseCode(201).setBody(
                """{"access_token":"a","refresh_token":"r","user":{"user_id":"voter-001","role":"citizen_voter"}}""",
            ),
        )
        sessions.signIn(TranUserRole.CITIZEN_VOTER)
        assertEquals(UpdateRecommendation("3.0.0"), api.standing.recommendation)
    }
}
