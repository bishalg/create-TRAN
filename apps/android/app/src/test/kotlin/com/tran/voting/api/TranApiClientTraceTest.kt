// Verifies: REQ-OBS-010
package com.tran.voting.api

import com.tran.voting.parity.VoteEligibilityParityTest
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.parseTraceparentOffline

/** REQ-OBS-010: Every API call carries a trace; retries reuse the trace id with a new span id. */
class TranApiClientTraceTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private val instantRetry = TranRetry(sleep = {}, random = { 0.0 })
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

    private fun client() = TranApiClient(
        baseUrl = server.url("/").toString(),
        includeDebugCountry = false,
        retry = instantRetry,
    )

    @Test
    fun apiCallCarriesValidTraceparentHeader() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        client().checkHealth()

        val request = server.takeRequest()
        val header = request.getHeader("traceparent")
        assertNotNull("traceparent header must be present", header)

        val parsed = parseTraceparentOffline(header!!)
        assertNotNull("traceparent must be valid W3C format", parsed)
        assertEquals(32, parsed!!.traceId.length)
        assertEquals(16, parsed.spanId.length)
        assertTrue(parsed.sampled)
    }

    @Test
    fun retryReusesTraceIdWithNewSpanId() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        client().checkHealth()

        assertEquals(2, server.requestCount)
        val r1 = server.takeRequest()
        val r2 = server.takeRequest()

        val h1 = r1.getHeader("traceparent")
        val h2 = r2.getHeader("traceparent")
        assertNotNull(h1)
        assertNotNull(h2)

        val t1 = parseTraceparentOffline(h1!!)
        val t2 = parseTraceparentOffline(h2!!)
        assertNotNull(t1)
        assertNotNull(t2)

        // Same trace ID across retries
        assertEquals(t1!!.traceId, t2!!.traceId)
        // Fresh child span ID for each attempt
        assertNotEquals(t1.spanId, t2.spanId)
    }

    @Test
    fun confirmEligibilitySendsTrace() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        client().confirmEligibility(21, "NP")

        val request = server.takeRequest()
        val header = request.getHeader("traceparent")
        assertNotNull(header)
        val parsed = parseTraceparentOffline(header!!)
        assertNotNull(parsed)
        assertEquals(32, parsed!!.traceId.length)
    }
}
