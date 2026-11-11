// Verifies: REQ-OBS-011 REQ-ERR-011 REQ-ERR-014
package com.tran.voting.ui.feedback

import com.tran.voting.api.TranRequestFailure
import com.tran.voting.parity.VoteEligibilityParityTest
import java.io.IOException
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranErrorCode

/** REQ-OBS-011: Client failure can be joined to server's logs via trace_id in TranReporting. */
class TranReportingTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }

    @After
    fun tearDown() {
        TranReporting.sink = null
    }

    @Test
    fun reportDeliversTraceIdForServerError() {
        var reportedEvent: TranReporting.Event? = null
        var reportedCause: Throwable? = null
        TranReporting.sink = { event, cause ->
            reportedEvent = event
            reportedCause = cause
        }

        val traceId = "4bf92f3577b34da6a3ce929d0e0e4736"
        val failure = TranRequestFailure(
            code = TranErrorCode.SERVER_INTERNAL,
            status = 500,
            requestId = "req-456",
            traceId = traceId,
        )

        TranReporting.report(failure)

        assertNotNull(reportedEvent)
        assertEquals("server.internal", reportedEvent?.code)
        assertEquals(500, reportedEvent?.status)
        assertEquals("req-456", reportedEvent?.requestId)
        assertEquals(traceId, reportedEvent?.traceId)
        assertNull(reportedCause)
    }

    @Test
    fun reportDeliversTraceIdForTransportFailureWhenReported() {
        var reportedEvent: TranReporting.Event? = null
        var reportedCause: Throwable? = null
        TranReporting.sink = { event, cause ->
            reportedEvent = event
            reportedCause = cause
        }

        val traceId = "11111111222233334444555566667777"
        val cause = IllegalArgumentException("unparseable payload")
        val failure = TranRequestFailure.classify(cause, traceId = traceId)

        TranReporting.report(failure)

        assertNotNull(reportedEvent)
        assertEquals("client.unexpected", reportedEvent?.code)
        assertEquals(traceId, reportedEvent?.traceId)
        assertEquals(cause, reportedCause)
    }

    @Test
    fun classifyPreservesTraceIdWhenNoResponseArrived() {
        val traceId = "99999999888877776666555544443333"
        val networkError = IOException("network unreachable")
        val failure = TranRequestFailure.classify(networkError, traceId = traceId)

        assertEquals(TranErrorCode.NETWORK_OFFLINE, failure.code)
        assertEquals(traceId, failure.traceId)
        assertNull(failure.status)
    }
}
