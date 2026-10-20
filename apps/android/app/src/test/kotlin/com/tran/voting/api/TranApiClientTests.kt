// Verifies: REQ-NAT-011
package com.tran.voting.api

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The native client contract on a stubbed server: paths, payloads, debug gating, offline split. */
class TranApiClientTests {
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
    )

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
    fun httpRejectionIsOnlineBecauseTheServerAnswered() {
        runBlocking {
            server.enqueue(MockResponse().setResponseCode(403))
            try {
                client().checkHealth()
                assertTrue("the client must throw on a rejection", false)
            } catch (error: TranApiError.Rejected) {
                assertEquals(403, error.status)
                assertEquals(TranApiStatus.ONLINE, tranApiStatusFrom(error))
            }
        }
    }

    @Test
    fun unreachableServerIsOffline() {
        server.shutdown()
        runBlocking {
            try {
                client().checkHealth()
                assertTrue("the client must throw when nothing listens", false)
            } catch (error: TranApiError.Offline) {
                assertEquals(TranApiStatus.OFFLINE, tranApiStatusFrom(error))
            }
        }
    }

    @Test
    fun debugBuildTargetsTheEmulatorHostAndShipsTheDevHeaderGate() {
        assertEquals("http://10.0.2.2:3001", TranApiConfig.baseUrl)
        assertTrue(TranApiConfig.includeDebugCountry)
    }
}
