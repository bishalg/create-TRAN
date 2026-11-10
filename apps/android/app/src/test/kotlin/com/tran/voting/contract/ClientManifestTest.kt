// Verifies: REQ-VER-003 REQ-VER-004
package com.tran.voting.contract

import com.tran.voting.BuildConfig
import com.tran.voting.api.TranApiClient
import com.tran.voting.api.TranRequestFailure
import com.tran.voting.api.TranRetry
import com.tran.voting.generated.ApiContract
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.permissions.LocationFix
import com.tran.voting.permissions.PermissionGateway
import com.tran.voting.push.InMemoryPushStore
import com.tran.voting.push.PushRegistration
import com.tran.voting.push.PushTrigger
import com.tran.voting.push.STAGED_PUSH_TOKEN
import com.tran.voting.push.StagedPushGateway
import com.tran.voting.session.InMemorySessionVault
import com.tran.voting.session.SessionClient
import com.tran.voting.session.StoredSession
import java.io.File
import java.lang.reflect.Modifier
import java.util.Collections
import java.util.Locale
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.TranPermissionStatus
import uniffi.tran_uniffi.TranUserRole

/**
 * `fixtures/contract/clients/android/current.json` is what this app sends and reads, and it cannot
 * drift from the code (REQ-VER-003). A JVM test, not a scan of Kotlin text, because only running
 * the client shows what it sends and which fields its decoding really needs:
 *
 * 1. only `TranApiClient` and `SessionClient` build requests, and every public method of the two is
 *    either mapped to a manifest entry below or makes no request;
 * 2. each call, run against a fake API answering with the contract snapshots, sends exactly its
 *    entry (method, path, `X-Tran-Client`, credential, body);
 * 3. `reads` is exactly what the app requires: the call fails when a declared field is missing or
 *    of another type, and succeeds when any undeclared field of the answer is missing.
 */
class ClientManifestTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private val repoRoot = File(System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set (Gradle test task should provide it)"))
        private fun fixture(path: String) = File(repoRoot, "fixtures/contract/$path").readText()

        private val manifest = JSONObject(fixture("clients/android/current.json"))
        private val snapshots = JSONArray(fixture("v1/responses.json"))

        /** The installation id the replay uses for `{installation_id}`. */
        private const val INSTALLATION_ID = "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c"
        private const val STORED_REFRESH = "refresh-stored-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
        private val instant = TranRetry(sleep = {}, random = { 0.0 })

        /** The two classes that build requests, and where they live. */
        private val CLIENT_SOURCES = setOf(
            "src/main/kotlin/com/tran/voting/api/TranApiClient.kt",
            "src/main/kotlin/com/tran/voting/session/SessionClient.kt",
        )
    }

    /** One way to make a request: what runs first (unrecorded), then the call itself. */
    private class Run(val entry: String?, val setup: suspend Harness.() -> Unit = {}, val call: suspend Harness.() -> Unit)

    private val signedIn: suspend Harness.() -> Unit = { sessions.signIn(TranUserRole.CITIZEN_VOTER) }

    /**
     * Every public method of the two clients, by name, and the manifest entry each call sends
     * (`null`: no request). A new public method fails [everyPublicCallIsMapped] until it is here.
     */
    private val calls: Map<String, List<Run>> = mapOf(
        "checkHealth" to listOf(Run("checkHealth") { api.checkHealth() }),
        // The recovery probe asks the same question, once.
        "probeHealth" to listOf(Run("checkHealth") { api.probeHealth() }),
        "confirmEligibility" to listOf(Run("confirmEligibility") { api.confirmEligibility(20, "NP") }),
        "signIn" to listOf(Run("signIn") { sessions.signIn(TranUserRole.CITIZEN_VOTER) }),
        "currentUser" to listOf(
            Run("currentUser", signedIn) { sessions.currentUser() },
            // After a restart only the refresh token is stored: the first request refreshes.
            Run("refresh", { vault.write(StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, STORED_REFRESH)) }) { sessions.currentUser() },
        ),
        "deleteAccount" to listOf(Run("deleteAccount", signedIn) { sessions.deleteAccount() }),
        "signOut" to listOf(Run("revoke", signedIn) { sessions.signOut() }),
        "revoke" to listOf(Run("revoke", signedIn) { sessions.revoke(sessions.endLocally()) }),
        "endLocally" to listOf(Run(null, signedIn) { sessions.endLocally() }),
        "end" to listOf(Run(null, signedIn) { sessions.end() }),
        // Its one caller builds the body: the push sync.
        "registerDevice" to listOf(Run("registerDevice", signedIn) { push().sync(PushTrigger.LAUNCH) }),
        "unregisterDevice" to listOf(
            Run("unregisterDevice", signedIn) { sessions.unregisterDevice(INSTALLATION_ID) },
            Run("unregisterDevice", signedIn) { sessions.unregisterDevice(INSTALLATION_ID, sessions.end()) },
        ),
    )

    private fun entries(): List<JSONObject> = manifest.getJSONArray("requests").let { list -> (0 until list.length()).map(list::getJSONObject) }

    private fun entry(name: String): JSONObject = entries().single { it.getString("name") == name }

    /** The route template a concrete path stands for. */
    private fun template(path: String) = path.replace(Regex("/devices/[^/]+$"), "/devices/{installation_id}")

    /**
     * The first successful snapshot of a route. The snapshots record the refresh through the cookie
     * transport; the native refresh (body transport) answers the sign-in's shape, refresh token included.
     */
    private fun snapshot(route: String): Pair<Int, Any?> {
        val wanted = if (route == "POST ${ApiContract.basePath}/auth/refresh") "POST ${ApiContract.basePath}/auth/session" else route
        val row = (0 until snapshots.length()).map(snapshots::getJSONObject).first { row ->
            row.getString("route") == wanted && row.getInt("status") in 200..299 &&
                (wanted != "POST ${ApiContract.basePath}/auth/session" || row.optJSONObject("body")?.has("refresh_token") == true)
        }
        return row.getInt("status") to row.opt("body")?.takeUnless { it == JSONObject.NULL }
    }

    /** A fake API, two clients on it as the app builds them, and what they sent. */
    private inner class Harness(private val mutate: ((Any) -> Any)? = null) : AutoCloseable {
        val sent: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())
        var recording = false
        private val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val first = recording && sent.isEmpty()
                    if (recording) sent += request
                    val (status, body) = snapshot("${request.method} ${template(request.requestUrl!!.encodedPath)}")
                    val answer = if (first && body != null && mutate != null) mutate.invoke(body) else body
                    return MockResponse().setResponseCode(status).apply { answer?.let { setBody(it.toString()) } }
                }
            }
            start()
        }
        val api = TranApiClient(baseUrl = server.url("/").toString(), includeDebugCountry = false, retry = instant)
        val vault = InMemorySessionVault()
        val sessions = SessionClient(vault, baseUrl = server.url("/").toString(), log = { _, _ -> }, standing = api.standing)

        fun push() = PushRegistration(
            StagedPushGateway(available = true, current = STAGED_PUSH_TOKEN),
            Granted,
            sessions,
            InMemoryPushStore(installationId = INSTALLATION_ID),
            locale = { Locale.ENGLISH },
            log = { _, _ -> },
        )

        /** Runs [run]; the requests of its call only. Throws what the call throws. */
        fun record(run: Run): List<RecordedRequest> = runBlocking {
            run.setup(this@Harness)
            recording = true
            run.call(this@Harness)
            sent.toList()
        }

        /** Whether [run]'s call succeeds; a failure the client classifies is `false`. */
        fun succeeds(run: Run): Boolean = try {
            record(run)
            true
        } catch (_: TranRequestFailure) {
            false
        }

        override fun close() = server.shutdown()
    }

    private object Granted : PermissionGateway {
        override fun status(id: TranPermissionId) = TranPermissionStatus.GRANTED
        override suspend fun request(id: TranPermissionId) = TranPermissionStatus.GRANTED
        override suspend fun locationFix(): LocationFix? = null
        override fun openSettings(id: TranPermissionId) = Unit
    }

    private fun publicMethods(type: Class<*>): Set<String> = type.declaredMethods
        .filter { Modifier.isPublic(it.modifiers) && !it.isSynthetic && '$' !in it.name }
        .map { it.name }
        .filterNot { Regex("(get|is|has)[A-Z].*").matches(it) }
        .toSet()

    @Test
    fun `REQ-VER-003 only the two API clients build a request`() {
        val app = File(repoRoot, "apps/android/app")
        val builders = File(app, "src/main/kotlin").walkTopDown()
            .filter { it.isFile && it.extension == "kt" && "/generated/" !in it.path && "/uniffi/" !in it.path }
            .filter { Regex("""Request\.Builder\(|\.newCall\(|openConnection\(|HttpURLConnection""").containsMatchIn(it.readText()) }
            .map { it.relativeTo(app).invariantSeparatorsPath }
            .toSet()
        assertEquals(CLIENT_SOURCES, builders)
    }

    @Test
    fun `REQ-VER-003 every public call is mapped, and every entry is sent by one`() {
        assertEquals("android", manifest.getString("platform"))
        val methods = publicMethods(TranApiClient::class.java) + publicMethods(SessionClient::class.java)
        assertEquals("map each public method of the clients in `calls`", methods, calls.keys)
        val sentBySomething = calls.values.flatten().mapNotNull { it.entry }.toSet()
        assertEquals(entries().map { it.getString("name") }.toSet(), sentBySomething)
        assertEquals("each entry once", entries().size, sentBySomething.size)
    }

    @Test
    fun `REQ-VER-003 REQ-VER-004 each call sends exactly its entry`() {
        for ((method, runs) in calls) for (run in runs) Harness().use { harness ->
            val sent = harness.record(run)
            val name = run.entry
            if (name == null) {
                assertEquals("$method makes no request", emptyList<RecordedRequest>(), sent)
                return@use
            }
            val entry = entry(name)
            val request = sent.first()
            val where = "$method › $name"
            assertEquals(where, entry.getString("method"), request.method)
            assertEquals(where, entry.getString("path").replace("{installation_id}", INSTALLATION_ID), request.requestUrl!!.encodedPath)
            assertNull("$where: no query", request.requestUrl!!.query)
            val headers = entry.getJSONObject("headers")
            assertEquals("$where: only the client header is listed", setOf(ApiContract.clientHeader), headers.fieldNames())
            val version = BuildConfig.VERSION_NAME
            assertEquals(where, headers.getString(ApiContract.clientHeader).replace("{version}", version), request.getHeader(ApiContract.clientHeader))
            assertNull("$where: a release build sends no debug country", request.getHeader("X-Debug-Country"))
            val auth = entry.optString("auth").ifEmpty { null }
            assertEquals("$where: bearer", auth == "bearer", request.getHeader("Authorization")?.startsWith("Bearer ") == true)
            val actual = request.body.readUtf8().ifEmpty { null }
            // The refresh token goes where the entry says `{refresh_token}`: the one in the vault.
            val refresh = if (auth == "refresh_token") JSONObject(actual!!).getString("refresh_token") else null
            if (refresh != null) assertTrue("$where: the stored refresh token", refresh in setOf(STORED_REFRESH, "<token>"))
            val expected = entry.opt("body")?.toString()
                ?.replace("{version}", version)
                ?.replace("\"{refresh_token}\"", JSONObject.quote(refresh ?: "-"))
            assertJsonEquals(where, expected, actual)
        }
    }

    private fun assertJsonEquals(where: String, expected: String?, actual: String?) {
        if (expected == null || actual == null) return assertEquals("$where: body", expected, actual)
        assertEquals("$where: body", plain(JSONTokener(expected).nextValue()), plain(JSONTokener(actual).nextValue()))
    }

    /** A JSON value as Kotlin maps and lists, so two bodies compare whatever their key order. */
    private fun plain(value: Any?): Any? = when (value) {
        is JSONObject -> value.fieldNames().associateWith { plain(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { plain(value.get(it)) }
        else -> value
    }

    /** Every leaf of a JSON answer, by dotted path (`user.role`). */
    private fun leaves(value: Any, path: String = ""): List<String> = when (value) {
        is JSONObject -> value.fieldNames().flatMap { key -> leaves(value.get(key), if (path.isEmpty()) key else "$path.$key") }
        else -> listOf(path)
    }

    /** [body] with the leaf at [path] removed, or replaced by [replacement]. */
    private fun edited(body: Any, path: String, replacement: Any? = null): Any {
        val copy = JSONObject(body.toString())
        val keys = path.split('.')
        val parent = keys.dropLast(1).fold(copy) { node, key -> node.getJSONObject(key) }
        if (replacement == null) parent.remove(keys.last()) else parent.put(keys.last(), replacement)
        return copy
    }

    private fun jsonType(value: Any): String = when (value) {
        is String -> "string"
        is Boolean -> "boolean"
        is Number -> "number"
        is JSONArray -> "array"
        else -> "object"
    }

    @Test
    fun `REQ-VER-003 reads is exactly what the decoding requires`() {
        for ((method, runs) in calls) for (run in runs) {
            val name = run.entry ?: continue
            val entry = entry(name)
            val reads = entry.getJSONObject("reads")
            val route = "${entry.getString("method")} ${entry.getString("path")}"
            val body = snapshot(route).second
            if (body == null) {
                assertEquals("$method › $name: a 204 has nothing to read", 0, reads.length())
                continue
            }
            for (field in leaves(body)) {
                val required = reads.has(field)
                val where = "$method › $name › $field"
                assertEquals(
                    if (required) "$where is declared but the call succeeds without it" else "$where is read but not declared",
                    !required,
                    Harness(mutate = { edited(it, field) }).use { it.succeeds(run) },
                )
                if (required) {
                    val value = field.split('.').fold<String, Any>(body) { node, key -> (node as JSONObject).get(key) }
                    assertEquals(where, reads.getString(field), jsonType(value))
                    val other: Any = if (value is String) 7 else "seven"
                    assertFalse("$where of another type is accepted", Harness(mutate = { edited(it, field, other) }).use { it.succeeds(run) })
                }
            }
            for (field in reads.fieldNames()) assertTrue("$method › $name › $field is not in the answer", field in leaves(body))
            assertTrue("$method › $name: the unedited answer is accepted", Harness().use { it.succeeds(run) })
        }
    }
}

/** The object's keys (Android's `JSONObject`, which the JVM tests compile against, has no `keySet`). */
internal fun JSONObject.fieldNames(): Set<String> = keys().asSequence().toSet()
