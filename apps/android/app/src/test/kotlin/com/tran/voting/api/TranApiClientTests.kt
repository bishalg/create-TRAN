// Verifies: REQ-NAT-011 REQ-ERR-004 REQ-ERR-005 REQ-ROB-010
package com.tran.voting.api

import com.tran.voting.parity.VoteEligibilityParityTest
import java.io.IOException
import java.net.SocketTimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import java.io.File
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.isValidRequestId
import uniffi.tran_uniffi.retryDelayMs
import uniffi.tran_uniffi.retryPolicy

/** The native client contract on a stubbed server: paths, payloads, debug gating, offline split. */
class TranApiClientTests {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        /** Retries never really wait in tests. */
        private val instant = TranRetry(sleep = {}, random = { 0.0 })
    }

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun client(includeDebugCountry: Boolean = false) = TranApiClient(
        baseUrl = server.url("/").toString(),
        includeDebugCountry = includeDebugCountry,
        retry = instant,
    )

    private suspend fun failureOf(call: suspend () -> Unit): TranRequestFailure? = try {
        call()
        null
    } catch (failure: TranRequestFailure) {
        failure
    }

    private fun enqueueOk() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
    }

    @Test
    fun healthChecksTheHealthEndpoint() {
        runBlocking {
            enqueueOk()
            client().checkHealth()
            val request = server.takeRequest()
            assertEquals("/api/health", request.path)
            assertEquals("GET", request.method)
        }
    }

    @Test
    fun confirmPostsOnlyTheAge() {
        runBlocking {
            enqueueOk()
            client().confirmEligibility(20, "NP")
            val request = server.takeRequest()
            assertEquals("/api/vote/eligibility", request.path)
            assertEquals("POST", request.method)
            assertEquals("application/json", request.getHeader("Content-Type")?.substringBefore(';'))
            assertEquals("""{"age":20}""", request.body.readUtf8())
        }
    }

    @Test
    fun debugCountryHeaderIsSentOnlyWhenTheDebugGateIsOn() {
        runBlocking {
            enqueueOk()
            client(includeDebugCountry = true).confirmEligibility(20, "np")
            assertEquals("NP", server.takeRequest().getHeader("X-Debug-Country"))

            enqueueOk()
            client(includeDebugCountry = false).confirmEligibility(20, "NP")
            assertNull(server.takeRequest().getHeader("X-Debug-Country"))
        }
    }

    @Test
    fun debugCountryHeaderSkipsNonCountryValues() {
        runBlocking {
            enqueueOk()
            client(includeDebugCountry = true).confirmEligibility(20, "N1")
            assertNull(server.takeRequest().getHeader("X-Debug-Country"))
        }
    }

    @Test
    fun healthIsSentWithoutTheDebugHeader() {
        runBlocking {
            enqueueOk()
            client(includeDebugCountry = true).checkHealth()
            assertNull(server.takeRequest().getHeader("X-Debug-Country"))
        }
    }

    @Test
    fun envelopeCodeAndRequestIdAreReadAndValidationIsNotRetried() {
        runBlocking {
            server.enqueue(
                MockResponse().setResponseCode(400).setBody(
                    """{"success":false,"error":"nope","code":"validation.invalid_country_code","retryable":false,"request_id":"req-1"}""",
                ),
            )
            val failure = failureOf { client().confirmEligibility(20, "NP") }
            assertEquals(TranErrorCode.VALIDATION_INVALID_COUNTRY_CODE, failure?.code)
            assertEquals("req-1", failure?.requestId)
            assertEquals(1, server.requestCount)
            assertEquals(TranApiStatus.ONLINE, tranApiStatusFrom(failure!!))
        }
    }

    @Test
    fun statusWithoutACodeUsesTheFallbackTableAndTheHeaderId() {
        runBlocking {
            server.enqueue(MockResponse().setResponseCode(403).setHeader("x-request-id", "edge-7").setBody("<html>"))
            val failure = failureOf { client().checkHealth() }!!
            assertEquals(TranErrorCode.REQUEST_MALFORMED, failure.code)
            assertEquals(403, failure.status)
            assertEquals("edge-7", failure.requestId)
            assertEquals("the server answered", TranApiStatus.ONLINE, tranApiStatusFrom(failure))
        }
    }

    @Test
    fun flakyServerIsRetriedUntilItAnswers() {
        runBlocking {
            server.enqueue(MockResponse().setResponseCode(503).setHeader("retry-after", "1"))
            enqueueOk()
            client().confirmEligibility(20, "NP")
            assertEquals(2, server.requestCount)
        }
    }

    @Test
    fun retryWaitsTheRustScheduleOrTheServersRetryAfter() {
        runBlocking {
            val waits = mutableListOf<Long>()
            val retry = TranRetry(sleep = { waits += it }, random = { 0.5 })
            var attempt = 0
            val outcome = retry.run(idempotent = true) {
                attempt += 1
                when (attempt) {
                    1 -> throw TranRequestFailure(TranErrorCode.SERVER_INTERNAL)
                    2 -> throw TranRequestFailure(TranErrorCode.SERVER_RATE_LIMITED, retryAfterDelayMs = 2000)
                    else -> attempt
                }
            }
            assertEquals(3, outcome)
            assertEquals(listOf(retryDelayMs(1u, 0.5).toLong(), 2000L), waits)
        }
    }

    @Test
    fun nonIdempotentCallsAreNeverRetried() {
        runBlocking {
            var attempts = 0
            val failure = failureOf {
                instant.run(idempotent = false) {
                    attempts += 1
                    throw TranRequestFailure(TranErrorCode.SERVER_UNAVAILABLE)
                }
            }
            assertEquals(1, attempts)
            assertEquals(TranErrorCode.SERVER_UNAVAILABLE, failure?.code)
        }
    }

    @Test
    fun unreachableServerIsOfflineAfterEveryAttempt() {
        server.shutdown()
        runBlocking {
            val failure = failureOf { client().checkHealth() }!!
            assertEquals(TranErrorCode.NETWORK_OFFLINE, failure.code)
            assertEquals(TranApiStatus.OFFLINE, tranApiStatusFrom(failure))
        }
        assertTrue(retryPolicy().maxAttempts > 1u)
    }

    @Test
    fun transportErrorsAreClassified() {
        assertEquals(TranErrorCode.NETWORK_TIMEOUT, TranRequestFailure.classify(SocketTimeoutException()).code)
        assertEquals(TranErrorCode.NETWORK_OFFLINE, TranRequestFailure.classify(IOException("refused")).code)
        assertEquals(TranErrorCode.REQUEST_CANCELLED, TranRequestFailure.classify(CancellationException("gone")).code)
        assertEquals(TranErrorCode.CLIENT_UNEXPECTED, TranRequestFailure.classify(IllegalStateException()).code)
    }

    private fun fixture(name: String): JSONObject {
        val repoRoot = File(System.getenv("REPO_ROOT") ?: "../../..")
        return JSONObject(File(repoRoot, "fixtures/$name").readText())
    }

    /** `fixtures/failure-modes.json` `responses`: the same answers the web and iOS classify. */
    @Test
    fun everyFailureModeResponseClassifiesLikeTheOtherClients() {
        val rows = fixture("failure-modes.json").getJSONArray("responses")
        assertTrue(rows.length() > 0)
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            val label = "${row.getString("id")} ${row.getString("name")}"
            val expect = row.getJSONObject("expect")
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val response = MockResponse().setResponseCode(row.getInt("status")).setBody(row.getString("body"))
                    row.optJSONObject("headers")?.let { headers ->
                        headers.keys().forEach { response.setHeader(it, headers.getString(it)) }
                    }
                    return response
                }
            }
            val failure = runBlocking { failureOf { client().checkHealth() } }
            assertEquals(label, expect.getString("code"), failure?.spec?.wireCode)
            assertEquals(label, row.getInt("status"), failure?.status)
            assertEquals(label, if (expect.isNull("requestId")) null else expect.getString("requestId"), failure?.requestId)
            if (expect.has("retryAfterMs")) {
                val delay = if (expect.isNull("retryAfterMs")) null else expect.getLong("retryAfterMs")
                assertEquals(label, delay, failure?.retryAfterDelayMs)
            }
        }
    }

    @Test
    fun requestIdShapeMatchesTheFixture() {
        val ids = fixture("feedback.json").getJSONObject("requestIds")
        val valid = ids.getJSONArray("valid")
        val invalid = ids.getJSONArray("invalid")
        for (i in 0 until valid.length()) assertTrue(valid.getString(i), isValidRequestId(valid.getString(i)))
        for (i in 0 until invalid.length()) assertFalse(invalid.getString(i), isValidRequestId(invalid.getString(i)))
    }

    @Test
    fun debugBuildTargetsTheEmulatorHostAndShipsTheDevHeaderGate() {
        assertEquals("http://10.0.2.2:3001", TranApiConfig.baseUrl)
        assertTrue(TranApiConfig.includeDebugCountry)
    }
}
