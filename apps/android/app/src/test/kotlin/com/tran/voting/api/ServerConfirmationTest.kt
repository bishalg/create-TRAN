package com.tran.voting.api

import com.tran.voting.parity.VoteEligibilityParityTest
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranVerdictSource
import uniffi.tran_uniffi.loadingPolicy
import uniffi.tran_uniffi.verdictSourceSpec

/**
 * The background server confirmation on virtual time (`kotlinx-coroutines-test`): the owner runs
 * in `backgroundScope`, so `delay` never really waits and a hanging run ends with the test.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ServerConfirmationTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }

    private val delayMs: Long get() = loadingPolicy().indicatorDelayMs.toLong()

    /** Every `onSettled` call, in order; a cancelled run must never add one. */
    private val settled = mutableListOf<TranRequestFailure?>()

    private fun TestScope.confirmation() = ServerConfirmation(backgroundScope)

    private fun ServerConfirmation.startRecording(run: suspend () -> Unit) = start(run) { settled += it }

    // Verifies: REQ-LOAD-002
    @Test
    fun `REQ-LOAD-002 a run that settles before the delay never shows the indicator`() = runTest {
        val confirmation = confirmation()
        confirmation.startRecording { delay(delayMs - 1) }

        advanceTimeBy(delayMs - 1)
        runCurrent()
        assertFalse(confirmation.isPending)
        assertEquals(ServerConfirmation.Phase.Confirmed, confirmation.phase)

        advanceTimeBy(delayMs)
        assertFalse("the indicator must not appear after the answer", confirmation.isPending)
        assertEquals(listOf<TranRequestFailure?>(null), settled)
    }

    // Verifies: REQ-LOAD-002 REQ-LOAD-001
    @Test
    fun `REQ-LOAD-002 the indicator appears at the policy delay and leaves when the run settles`() = runTest {
        val confirmation = confirmation()
        val answer = CompletableDeferred<Unit>()
        confirmation.startRecording { answer.await() }

        advanceTimeBy(delayMs - 1)
        assertFalse("not before the delay", confirmation.isPending)
        assertEquals(verdictSourceSpec(TranVerdictSource.DEVICE).messageKey, confirmation.captionKey)

        advanceTimeBy(1)
        runCurrent()
        assertTrue(confirmation.isPending)
        assertEquals(loadingPolicy().pendingMessageKey, confirmation.captionKey)
        assertEquals("the verdict source waits for the answer", TranVerdictSource.DEVICE, confirmation.source)

        answer.complete(Unit)
        runCurrent()
        assertFalse(confirmation.isPending)
        assertEquals(TranVerdictSource.SERVER, confirmation.source)
        assertEquals(verdictSourceSpec(TranVerdictSource.SERVER).messageKey, confirmation.captionKey)
    }

    // Verifies: REQ-LOAD-002
    @Test
    fun `REQ-LOAD-002 a failure also clears the indicator and is classified once`() = runTest {
        val confirmation = confirmation()
        confirmation.startRecording {
            delay(delayMs * 2)
            throw IOException("refused")
        }

        advanceTimeBy(delayMs + 1)
        assertTrue(confirmation.isPending)

        advanceTimeBy(delayMs * 2)
        assertFalse(confirmation.isPending)
        assertEquals(TranErrorCode.NETWORK_OFFLINE, settled.single()?.code)
        val phase = confirmation.phase as ServerConfirmation.Phase.Failed
        assertEquals(TranErrorCode.NETWORK_OFFLINE, phase.failure.code)
    }

    // Verifies: REQ-LOAD-004
    @Test
    fun `REQ-LOAD-004 starting again cancels the previous run and its answer never lands`() = runTest {
        val confirmation = confirmation()
        val firstAnswer = CompletableDeferred<Unit>()
        var firstCancelled = false
        confirmation.startRecording {
            try {
                firstAnswer.await()
            } catch (cancelled: CancellationException) {
                firstCancelled = true
                throw cancelled
            }
        }
        advanceTimeBy(delayMs + 1)
        assertTrue(confirmation.isPending)

        val secondAnswer = CompletableDeferred<Unit>()
        confirmation.startRecording {
            secondAnswer.await()
            throw TranRequestFailure(TranErrorCode.SERVER_INTERNAL)
        }
        runCurrent()
        assertTrue("the first run is cancelled at once", firstCancelled)
        assertFalse("the new run starts without an indicator", confirmation.isPending)

        firstAnswer.complete(Unit)
        runCurrent()
        assertTrue("a superseded answer changes nothing", settled.isEmpty())
        assertEquals(ServerConfirmation.Phase.Idle, confirmation.phase)

        secondAnswer.complete(Unit)
        runCurrent()
        assertEquals(TranErrorCode.SERVER_INTERNAL, settled.single()?.code)
    }

    // Verifies: REQ-LOAD-005
    @Test
    fun `REQ-LOAD-005 a new run speaks for the new device verdict until it settles`() = runTest {
        val confirmation = confirmation()
        confirmation.startRecording {}
        runCurrent()
        assertEquals(TranVerdictSource.SERVER, confirmation.source)

        // The previous answer does not vouch for the verdict the new tap just put on screen.
        val answer = CompletableDeferred<Unit>()
        confirmation.startRecording { answer.await() }
        assertEquals(TranVerdictSource.DEVICE, confirmation.source)
        assertEquals(verdictSourceSpec(TranVerdictSource.DEVICE).messageKey, confirmation.captionKey)
        advanceTimeBy(delayMs - 1)
        assertEquals("still the device before the delay", TranVerdictSource.DEVICE, confirmation.source)

        answer.complete(Unit)
        runCurrent()
        assertEquals(TranVerdictSource.SERVER, confirmation.source)
    }

    // Verifies: REQ-LOAD-004
    @Test
    fun `REQ-LOAD-004 cancel clears the indicator and leaves the phase and source untouched`() = runTest {
        val confirmation = confirmation()
        confirmation.startRecording { throw TranRequestFailure(TranErrorCode.NETWORK_OFFLINE) }
        runCurrent()
        assertEquals(TranVerdictSource.DEVICE_FALLBACK, confirmation.source)

        // Cancel alone (leaving the screen) keeps what the last settled run said.
        confirmation.cancel()
        assertEquals(TranVerdictSource.DEVICE_FALLBACK, confirmation.source)

        confirmation.startRecording { CompletableDeferred<Unit>().await() }
        advanceTimeBy(delayMs + 1)
        assertTrue(confirmation.isPending)

        confirmation.cancel()
        runCurrent()
        assertFalse(confirmation.isPending)
        assertEquals(ServerConfirmation.Phase.Idle, confirmation.phase)
        assertEquals(TranVerdictSource.DEVICE, confirmation.source)
        assertEquals("only the first, finished run settled", 1, settled.size)

        advanceTimeBy(delayMs * 10)
        assertFalse("a cancelled run never brings the indicator back", confirmation.isPending)
    }

    // Verifies: REQ-LOAD-004
    @Test
    fun `REQ-LOAD-004 cancel without a run is harmless`() = runTest {
        val confirmation = confirmation()
        confirmation.cancel()
        assertFalse(confirmation.isPending)
        assertEquals(ServerConfirmation.Phase.Idle, confirmation.phase)
    }

    // Verifies: REQ-LOAD-005
    @Test
    fun `REQ-LOAD-005 the source says which path answered`() = runTest {
        val confirmation = confirmation()
        assertEquals("nothing asked yet: the device decided", TranVerdictSource.DEVICE, confirmation.source)

        val cases = listOf(
            // No answer at all (banner): the device decided instead.
            TranErrorCode.NETWORK_OFFLINE to TranVerdictSource.DEVICE_FALLBACK,
            TranErrorCode.NETWORK_TIMEOUT to TranVerdictSource.DEVICE_FALLBACK,
            // A retryable server failure, once the retries are spent.
            TranErrorCode.SERVER_INTERNAL to TranVerdictSource.DEVICE_FALLBACK,
            // The server answered and refused the request: the device verdict stands on its own.
            TranErrorCode.VALIDATION_INVALID_DATE to TranVerdictSource.DEVICE,
        )
        for ((code, expected) in cases) {
            confirmation.startRecording { throw TranRequestFailure(code) }
            runCurrent()
            assertEquals("$code", expected, confirmation.source)
            assertEquals("$code", verdictSourceSpec(expected).messageKey, confirmation.captionKey)
        }

        confirmation.startRecording {}
        runCurrent()
        assertEquals("a later success returns to the server", TranVerdictSource.SERVER, confirmation.source)
        assertNull(settled.last())
    }
}
