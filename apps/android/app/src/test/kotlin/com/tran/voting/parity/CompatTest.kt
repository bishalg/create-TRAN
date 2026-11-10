// Verifies: REQ-VER-001 REQ-VER-004 REQ-VER-005 REQ-VER-008 REQ-VER-010
package com.tran.voting.parity

import com.tran.voting.api.TranApiClient
import com.tran.voting.contract.fieldNames
import com.tran.voting.api.TranRequestFailure
import com.tran.voting.api.TranRetry
import com.tran.voting.generated.ApiContract
import com.tran.voting.session.SessionClient
import com.tran.voting.session.tranUserRoleFromApi
import com.tran.voting.session.wire
import java.io.File
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranClientPlatform
import uniffi.tran_uniffi.TranClientStanding
import uniffi.tran_uniffi.TranUpdatePromptState
import uniffi.tran_uniffi.clientStanding
import uniffi.tran_uniffi.compareVersions
import uniffi.tran_uniffi.decodeWireEnum
import uniffi.tran_uniffi.formatClient
import uniffi.tran_uniffi.parseClient
import uniffi.tran_uniffi.updatePrompt

/**
 * `fixtures/compat.json` through UniFFI, the generated `ApiContract` and the app's own decoding
 * (spec 028). "Responses from the future" are read the way the app reads each route, and the
 * fields it reads are the ones its client manifest declares.
 */
class CompatTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private val repoRoot = File(System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set (Gradle test task should provide it)"))
        private val fixture = JSONObject(File(repoRoot, "fixtures/compat.json").readText())
        private val manifest = JSONObject(File(repoRoot, "fixtures/contract/clients/android/current.json").readText())
    }

    private fun rows(name: String): List<JSONObject> = fixture.getJSONArray(name).let { list -> (0 until list.length()).map(list::getJSONObject) }

    private fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else getString(key)

    private fun platform(name: String) = TranClientPlatform.valueOf(name.uppercase())

    private fun standing(name: String) = TranClientStanding.valueOf(name.uppercase())

    private fun JSONArray.strings(): List<String> = (0 until length()).map(::getString)

    @Test
    fun `REQ-VER-001 REQ-VER-004 the generated contract is the fixture's`() {
        assertEquals(fixture.getString("basePath"), ApiContract.basePath)
        assertEquals(fixture.getString("healthPath"), ApiContract.healthPath)
        val headers = fixture.getJSONObject("headers")
        assertEquals(headers.getString("client"), ApiContract.clientHeader)
        assertEquals(headers.getString("update"), ApiContract.updateHeader)
        assertEquals(headers.getString("updateRecommended"), ApiContract.updateRecommended)
        assertEquals(headers.getString("recommendedVersion"), ApiContract.recommendedVersionHeader)
    }

    @Test
    fun `REQ-VER-004 clients parse and format as the fixture says`() {
        for (row in rows("clients")) {
            val parsed = parseClient(row.stringOrNull("header"))
            assertEquals(row.getString("name"), row.getString("platform"), parsed.platform.name.lowercase())
            assertEquals(row.getString("name"), row.stringOrNull("version"), parsed.version)
        }
        for (row in rows("formatted")) {
            assertEquals(row.getString("header"), formatClient(platform(row.getString("platform")), row.getString("version")))
        }
    }

    @Test
    fun `REQ-VER-005 versions compare and clients stand as the fixture says`() {
        for (row in rows("versions")) {
            assertEquals("${row.getString("a")} vs ${row.getString("b")}", row.getInt("order"), compareVersions(row.getString("a"), row.getString("b")).toInt())
        }
        for (row in rows("standings")) {
            val client = parseClient(row.stringOrNull("client"))
            assertEquals(
                row.getString("name"),
                standing(row.getString("standing")),
                clientStanding(client, row.stringOrNull("minimum"), row.stringOrNull("recommended")),
            )
        }
    }

    @Test
    fun `REQ-VER-010 the update prompt shows as the fixture says`() {
        for (row in rows("updatePrompts")) {
            val state = TranUpdatePromptState(
                standing = standing(row.getString("standing")),
                recommendedVersion = row.stringOrNull("recommendedVersion"),
                dismissedVersion = row.stringOrNull("dismissedVersion"),
            )
            assertEquals(row.getString("name"), row.getBoolean("show"), updatePrompt(state))
        }
    }

    @Test
    fun `REQ-VER-008 the generated wire enums and their decoding are the fixture's`() {
        val generated = mapOf(
            "user_role" to Triple(ApiContract.WireEnums.UserRole.field, ApiContract.WireEnums.UserRole.values, ApiContract.WireEnums.UserRole.fallback),
            "country_source" to Triple(ApiContract.WireEnums.CountrySource.field, ApiContract.WireEnums.CountrySource.values, ApiContract.WireEnums.CountrySource.fallback),
        )
        val declared = rows("wireEnums")
        assertEquals(declared.map { it.getString("name") }.toSet(), generated.keys)
        for (row in declared) {
            val name = row.getString("name")
            assertEquals(name, Triple(row.getString("field"), row.getJSONArray("values").strings(), row.getString("fallback")), generated[name])
        }
        for (row in rows("wireEnumCases")) {
            val name = row.getString("enum")
            val raw = row.getString("raw")
            assertEquals("$name $raw", row.getString("decoded"), decodeWireEnum(name, raw))
            // The app's own reader of the one enum it reads.
            if (name == "user_role") assertEquals("$name $raw", row.getString("decoded"), tranUserRoleFromApi(raw).wire)
        }
    }

    /** What the app reads from one answer of [route], by the manifest's dotted paths. */
    private fun read(route: String, status: Int, body: JSONObject): Map<String, Any> = when (route) {
        "POST ${ApiContract.basePath}/auth/session", "POST ${ApiContract.basePath}/auth/refresh" -> {
            // The fixture shows the cookie transport's answer; the app asks for the body transport,
            // whose answer adds the refresh token (docs/API.md).
            val native = JSONObject(body.toString()).apply { if (!has("refresh_token")) put("refresh_token", "r".repeat(43)) }
            val token = SessionClient.decodeToken(native)
            mapOf(
                "access_token" to token.accessToken,
                "refresh_token" to token.refreshToken,
                "user.user_id" to token.user.userId,
                "user.role" to token.user.role.wire,
            )
        }
        "GET ${ApiContract.basePath}/auth/session" -> SessionClient.decodeUser(body).let { mapOf("user_id" to it.userId, "role" to it.role.wire) }
        "error envelope" -> {
            val response = Response.Builder()
                .request(Request.Builder().url("http://api.test/").build())
                .protocol(Protocol.HTTP_1_1)
                .code(status)
                .message("future")
                .body(body.toString().toResponseBody("application/json".toMediaType()))
                .build()
            val failure = TranRequestFailure.rejected(response)
            mapOf("code" to failure.spec.wireCode, "request_id" to failure.requestId.orEmpty())
        }
        // The app sends these and reads nothing back: the answer only has to be accepted.
        else -> {
            accepted(route, status, body)
            emptyMap()
        }
    }

    /** The app's call of [route] succeeds on [body] (health and the eligibility confirmation). */
    private fun accepted(route: String, status: Int, body: JSONObject) {
        val server = MockWebServer().apply { start() }
        try {
            server.enqueue(MockResponse().setResponseCode(status).setBody(body.toString()))
            val api = TranApiClient(baseUrl = server.url("/").toString(), includeDebugCountry = false, retry = TranRetry(sleep = {}))
            runBlocking {
                when (route) {
                    "GET ${ApiContract.healthPath}" -> api.checkHealth()
                    "POST ${ApiContract.basePath}/vote/eligibility" -> api.confirmEligibility(20, "NP")
                    else -> throw AssertionError("$route: the app calls it, so CompatTest must read it")
                }
            }
        } finally {
            server.shutdown()
        }
    }

    private fun dotted(body: Any, path: String): Any? = path.split('.').fold<String, Any?>(body) { node, key ->
        when (node) {
            is JSONObject -> node.opt(key)
            is JSONArray -> node.opt(key.toInt())
            else -> null
        }
    }

    @Test
    fun `REQ-VER-008 every response from the future is read the way the app reads it`() {
        val requests = manifest.getJSONArray("requests").let { list -> (0 until list.length()).map(list::getJSONObject) }
        val called = requests.associateBy { "${it.getString("method")} ${it.getString("path")}" }
        var readSomething = 0
        for (row in rows("responsesFromTheFuture")) {
            val route = row.getString("route")
            val body = row.getJSONObject("body")
            val expect = row.getJSONObject("expect")
            val entry = called[route]
            if (entry == null && route != "error envelope") {
                // A route this app never calls (the manifest says which it does).
                assertFalse(route, requests.any { it.getString("path") == route.substringAfter(' ') })
                continue
            }
            val values = read(route, row.getInt("status"), body)
            val declared = entry?.getJSONObject("reads")?.fieldNames() ?: values.keys
            assertEquals("$route: what the app reads is what its manifest declares", declared, values.keys)
            for (key in expect.fieldNames()) {
                if (key in values) {
                    readSomething++
                    assertEquals("$route › $key", expect.get(key).toString(), values.getValue(key))
                } else {
                    // A field this app never reads, ignored like any other it does not know.
                    assertTrue("$route › $key is in the answer", dotted(body, key) != null)
                }
            }
        }
        assertTrue("the session and error rows were read", readSomething >= 7)
    }
}
