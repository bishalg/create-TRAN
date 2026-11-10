// Verifies: REQ-PSH-009 REQ-PSH-010 REQ-PSH-011 REQ-PSH-012
package com.tran.voting.push

import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.permissions.LocationFix
import com.tran.voting.permissions.PermissionGateway
import com.tran.voting.session.InMemorySessionVault
import com.tran.voting.session.SessionClient
import java.util.Collections
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
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
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranLastRegistration
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.TranPermissionStatus
import uniffi.tran_uniffi.TranPushAction
import uniffi.tran_uniffi.TranUserRole

/**
 * The push sync against a stubbed API (MockWebServer, hermetic): each trigger, token rotation,
 * permission turned off, sign-out, no session, push unavailable, failures, and what is logged.
 */
class PushRegistrationTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private const val ACCESS = "access-push-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        private const val REFRESH = "refresh-push-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
        private const val TOKEN_A = "fcm-token-a:APA91bAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        private const val TOKEN_B = "fcm-token-b:APA91bBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
        private const val INSTALLATION = "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c"
        private const val DAY = 86_400L
        private const val T0 = 1_800_000_000L
    }

    /** A permission the test can turn off "in Settings". */
    private class Notifications(var status: TranPermissionStatus) : PermissionGateway {
        override fun status(id: TranPermissionId) = status
        override suspend fun request(id: TranPermissionId) = status
        override suspend fun locationFix(): LocationFix? = null
        override fun openSettings(id: TranPermissionId) = Unit
    }

    private lateinit var server: MockWebServer
    private val requests: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())
    private val logged: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private var deviceAnswer: () -> MockResponse = { MockResponse().setResponseCode(204) }
    private val vault = InMemorySessionVault()
    private var now = T0
    private val permission = Notifications(TranPermissionStatus.GRANTED)
    private val store = InMemoryPushStore(installationId = INSTALLATION)
    private lateinit var sessions: SessionClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                return when {
                    request.path == "/api/auth/session" && request.method == "POST" -> MockResponse().setResponseCode(201)
                        .setBody(
                            """{"user":{"user_id":"voter-001","role":"citizen_voter"},""" +
                                """"access_token":"$ACCESS","refresh_token":"$REFRESH"}""",
                        )
                    request.path == "/api/auth/sign-out" -> MockResponse().setResponseCode(204)
                    request.path!!.startsWith("/api/devices/") ->
                        if (request.getHeader("Authorization") == "Bearer $ACCESS") deviceAnswer() else MockResponse().setResponseCode(401)
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        sessions = SessionClient(
            vault,
            baseUrl = server.url("/").toString(),
            http = OkHttpClient(),
            io = Dispatchers.Unconfined,
            log = { level, line -> logged += "$level $line" },
        )
    }

    @After
    fun tearDown() = server.shutdown()

    private fun registration(gateway: PushGateway, client: SessionClient? = sessions, locale: Locale = Locale.forLanguageTag("ne-NP")) =
        PushRegistration(
            gateway, permission, client, store,
            locale = { locale }, appVersion = "0.1.0", now = { now },
            log = { level, line -> logged += "$level $line" },
        )

    private fun signedIn() = runBlocking { sessions.signIn(TranUserRole.CITIZEN_VOTER) }.also { requests.clear() }

    private fun devices() = requests.filter { it.path!!.startsWith("/api/devices/") }

    private fun assertNothingSecretLogged() {
        assertTrue("something was logged", logged.isNotEmpty())
        for (line in logged) {
            for (secret in listOf(TOKEN_A, TOKEN_B, INSTALLATION, ACCESS, REFRESH, "APA91b", "2f1c7a5e")) {
                assertFalse("$line names a token or the installation id", secret in line)
            }
        }
    }

    @Test
    fun `REQ-PSH-009 launch registers the token with the documented body and records it`() = runBlocking {
        signedIn()
        val gateway = StagedPushGateway(available = true, current = TOKEN_A)
        assertEquals(TranPushAction.REGISTER, registration(gateway).sync(PushTrigger.LAUNCH))
        val put = devices().single()
        assertEquals("PUT", put.method)
        assertEquals("/api/devices/$INSTALLATION", put.path)
        assertEquals("Bearer $ACCESS", put.getHeader("Authorization"))
        val body = JSONObject(put.body.readUtf8())
        assertEquals(
            setOf("platform", "push_token", "environment", "locale", "app_version", "marketing"),
            body.keys().asSequence().toSet(),
        )
        assertEquals("android", body.getString("platform"))
        assertEquals(TOKEN_A, body.getString("push_token"))
        assertEquals("production", body.getString("environment"))
        assertEquals("ne-NP", body.getString("locale"))
        assertEquals("0.1.0", body.getString("app_version"))
        assertEquals(false, body.getBoolean("marketing"))
        assertEquals(TranLastRegistration(TOKEN_A, T0), store.lastRegistration)
        assertNothingSecretLogged()
    }

    @Test
    fun `REQ-PSH-009 every trigger runs the same decision and a recent registration sends nothing`() = runBlocking {
        signedIn()
        val gateway = StagedPushGateway(available = true, current = TOKEN_A)
        val push = registration(gateway)
        assertEquals(TranPushAction.REGISTER, push.sync(PushTrigger.SIGN_IN))
        for (trigger in listOf(PushTrigger.LAUNCH, PushTrigger.FOREGROUND, PushTrigger.NEW_TOKEN, PushTrigger.PERMISSION_GRANTED)) {
            assertEquals("$trigger", TranPushAction.NOTHING, push.sync(trigger))
        }
        assertEquals(1, devices().size)
        // A week later the unchanged token is registered again, so the server never prunes it.
        now = T0 + 7 * DAY
        assertEquals(TranPushAction.REGISTER, push.sync(PushTrigger.FOREGROUND))
        assertEquals(2, devices().size)
        assertEquals(T0 + 7 * DAY, store.lastRegistration?.registeredAtUnixS)
        assertTrue(logged.any { "trigger=foreground action=register" in it })
    }

    @Test
    fun `REQ-PSH-009 a rotated token is registered on the new-token trigger`() = runBlocking {
        signedIn()
        val gateway = StagedPushGateway(available = true, current = TOKEN_A)
        val push = registration(gateway)
        var newToken = 0
        gateway.listen(object : PushEvents {
            override fun tokenChanged() {
                newToken += 1
            }

            override fun messageInForeground() = Unit
        })
        push.sync(PushTrigger.LAUNCH)
        gateway.issue(TOKEN_B)
        assertEquals(1, newToken)
        assertEquals(TranPushAction.REGISTER, push.sync(PushTrigger.NEW_TOKEN))
        assertEquals(TOKEN_B, JSONObject(devices().last().body.readUtf8()).getString("push_token"))
        assertEquals(TOKEN_B, store.lastRegistration?.token)
        assertNothingSecretLogged()
    }

    @Test
    fun `REQ-PSH-009 notifications turned off in Settings unregisters`() = runBlocking {
        signedIn()
        val push = registration(StagedPushGateway(available = true, current = TOKEN_A))
        push.sync(PushTrigger.LAUNCH)
        permission.status = TranPermissionStatus.DENIED_PERMANENTLY
        assertEquals(TranPushAction.UNREGISTER, push.sync(PushTrigger.FOREGROUND))
        val delete = devices().last()
        assertEquals("DELETE", delete.method)
        assertEquals("/api/devices/$INSTALLATION", delete.path)
        assertNull(store.lastRegistration)
        assertEquals(TranPushAction.NOTHING, push.sync(PushTrigger.FOREGROUND))
        assertEquals(2, devices().size)
    }

    @Test
    fun `REQ-PSH-009 without permission or a session no token is asked for and nothing is sent`() = runBlocking {
        val gateway = StagedPushGateway(available = true, current = TOKEN_A)
        assertEquals("no API session", TranPushAction.NOTHING, registration(gateway).sync(PushTrigger.LAUNCH))
        assertEquals("device-only session", TranPushAction.NOTHING, registration(gateway, client = null).sync(PushTrigger.LAUNCH))
        signedIn()
        permission.status = TranPermissionStatus.NOT_DETERMINED
        assertEquals("never asked", TranPushAction.NOTHING, registration(gateway).sync(PushTrigger.LAUNCH))
        assertEquals(0, gateway.tokenRequests)
        assertEquals(emptyList<RecordedRequest>(), requests.toList())
    }

    @Test
    fun `REQ-PSH-012 push unavailable registers nothing and never asks for a token`() = runBlocking {
        signedIn()
        val gateway = StagedPushGateway()
        assertEquals(TranPushAction.NOTHING, registration(gateway).sync(PushTrigger.LAUNCH))
        assertEquals(0, gateway.tokenRequests)
        assertEquals(emptyList<RecordedRequest>(), devices())
        // A registration recorded by an earlier build with push is unregistered.
        store.lastRegistration = TranLastRegistration(TOKEN_A, T0)
        assertEquals(TranPushAction.UNREGISTER, registration(gateway).sync(PushTrigger.LAUNCH))
        assertNull(store.lastRegistration)
    }

    @Test
    fun `REQ-PSH-009 a failed registration is logged once and tried again on the next trigger`() = runBlocking {
        signedIn()
        deviceAnswer = { MockResponse().setResponseCode(503).setHeader("x-request-id", "req-push-1") }
        val push = registration(StagedPushGateway(available = true, current = TOKEN_A))
        assertEquals(TranPushAction.REGISTER, push.sync(PushTrigger.LAUNCH))
        assertNull("nothing recorded", store.lastRegistration)
        val failures = logged.filter { "request failed" in it }
        assertEquals(1, failures.size)
        assertTrue(failures.single(), "push register request failed code=" in failures.single())
        deviceAnswer = { MockResponse().setResponseCode(204) }
        assertEquals(TranPushAction.REGISTER, push.sync(PushTrigger.FOREGROUND))
        assertNotNull(store.lastRegistration)
        assertNothingSecretLogged()
    }

    @Test
    fun `REQ-PSH-011 sign-out forgets the registration and deletes it before the session is revoked`() = runBlocking {
        signedIn()
        val push = registration(StagedPushGateway(available = true, current = TOKEN_A))
        push.sync(PushTrigger.LAUNCH)
        requests.clear()
        // The coordinator's order: forget, end the session on the device, then the network.
        assertTrue(push.forget())
        val ended = sessions.end()
        assertNull(store.lastRegistration)
        assertFalse(sessions.hasSession)
        push.unregisterAfterSignOut(ended)
        sessions.revoke(ended.refreshToken)
        assertEquals(listOf("DELETE /api/devices/$INSTALLATION", "POST /api/auth/sign-out"), requests.map { "${it.method} ${it.path}" })
        assertEquals("Bearer $ACCESS", requests.first().getHeader("Authorization"))
        assertEquals("EndedSession(redacted)", "$ended")
        assertNothingSecretLogged()
    }

    @Test
    fun `REQ-PSH-011 a failed or impossible unregister changes nothing`() = runBlocking {
        signedIn()
        val push = registration(StagedPushGateway(available = true, current = TOKEN_A))
        push.sync(PushTrigger.LAUNCH)
        deviceAnswer = { MockResponse().setResponseCode(500) }
        push.forget()
        val ended = sessions.end()
        push.unregisterAfterSignOut(ended)
        assertFalse("still signed out", sessions.hasSession)
        assertNull(store.lastRegistration)
        assertEquals(1, logged.count { "push unregister request failed" in it })
        // Unreachable: the same.
        server.shutdown()
        push.unregisterAfterSignOut(ended)
        assertFalse(sessions.hasSession)
        // No session at all: nothing to send, nothing recorded.
        assertFalse(push.forget())
        assertEquals(TranPushAction.NOTHING, push.sync(PushTrigger.LAUNCH))
    }

    @Test
    fun `REQ-PSH-010 the installation id is a random version-4 UUID per install`() {
        val ids = (1..20).map { newInstallationId() }
        val v4 = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        assertTrue(ids.all(v4::matches))
        assertEquals(ids.size, ids.toSet().size)
        assertNotEquals(InMemoryPushStore().installationId, InMemoryPushStore().installationId)
    }

    @Test
    fun `the locale is a plain language tag the API accepts`() {
        assertEquals("ne-NP", pushLocaleTag(Locale.forLanguageTag("ne-NP")))
        assertEquals("en-US", pushLocaleTag(Locale.forLanguageTag("en-US-u-mu-celsius")))
        assertEquals("zh-Hant-TW", pushLocaleTag(Locale.forLanguageTag("zh-Hant-TW")))
        assertEquals("hi", pushLocaleTag(Locale.forLanguageTag("hi")))
        assertEquals("und", pushLocaleTag(Locale.ROOT))
    }

    @Test
    fun `REQ-PSH-012 the build values switch push on only when all four are set`() {
        assertNull(fcmConfig(null, null, null, null))
        assertNull(fcmConfig("tran-demo", "1:123:android:abc", "AIzaPublic", ""))
        assertNull(fcmConfig("tran-demo", " ", "AIzaPublic", "123"))
        val config = assertNotNull(fcmConfig("tran-demo", "1:123:android:abc", "AIzaPublic", "123"))
        assertEquals("FcmConfig(redacted)", "$config")
        // The template is built without them: push is off (REQ-PSH-012).
        assertNull(fcmConfigFromBuild())
        assertEquals(false, StagedPushGateway().available)
    }

    private fun <T> assertNotNull(value: T?): T {
        org.junit.Assert.assertNotNull(value)
        return value!!
    }
}
