// Verifies: REQ-ERR-013
package com.tran.voting.api

import com.tran.voting.parity.VoteEligibilityParityTest
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.recoveryProbeDelayMs

/** The connectivity banner's recovery loop: Rust schedule, nudges, one probe at a time, silent stop. */
class RecoveryProbeTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }

    @Test
    fun probesOnTheScheduleUntilOneSucceeds() = runTest {
        val waits = mutableListOf<Long>()
        val probe = RecoveryProbe(this, sleep = { waits += it })
        var attempts = 0
        var recovered = 0
        probe.start(probe = { attempts += 1; if (attempts < 3) throw IOException("down") }, onRecovered = { recovered += 1 })
        advanceUntilIdle()
        assertEquals(3, attempts)
        assertEquals(1, recovered)
        assertEquals((1..3).map { recoveryProbeDelayMs(it.toUInt()).toLong() }, waits)
        assertFalse(probe.isRunning)
    }

    @Test
    fun nudgeProbesAtOnceInsteadOfWaiting() = runTest {
        // A wait that only ends by cancellation: only the nudge can start a probe.
        val probe = RecoveryProbe(this, sleep = { awaitCancellation() })
        var recovered = 0
        probe.start(probe = {}, onRecovered = { recovered += 1 })
        probe.nudge()
        runCurrent()
        assertEquals(1, recovered)
    }

    @Test
    fun aNudgeDuringAProbeDoesNotStartASecondOne() = runTest {
        val probe = RecoveryProbe(this, sleep = { awaitCancellation() })
        var calls = 0
        probe.start(probe = { calls += 1; awaitCancellation() }, onRecovered = {})
        probe.nudge()
        runCurrent()
        probe.nudge()
        runCurrent()
        assertEquals(1, calls)
        probe.stop()
    }

    @Test
    fun stopSilencesEverything() = runTest {
        val probe = RecoveryProbe(this, sleep = { awaitCancellation() })
        var calls = 0
        probe.start(probe = { calls += 1 }, onRecovered = { calls += 100 })
        probe.stop()
        probe.nudge()
        advanceUntilIdle()
        assertEquals(0, calls)
        assertFalse(probe.isRunning)
    }

    @Test
    fun aStoppedProbeThatFinishesLateDoesNotFreeANewerRun() = runTest {
        val probe = RecoveryProbe(this, sleep = { awaitCancellation() })
        val firstDone = CompletableDeferred<Unit>()
        var calls = 0
        // P1 ignores cancellation, like a blocking request that is still unwinding.
        probe.start(probe = { calls += 1; withContext(NonCancellable) { firstDone.await() } }, onRecovered = {})
        probe.nudge()
        runCurrent()
        probe.stop()
        probe.start(probe = { calls += 1; awaitCancellation() }, onRecovered = {})
        probe.nudge()
        runCurrent()
        firstDone.complete(Unit)
        runCurrent()
        // P2 is still in flight, so this nudge must not start P3.
        probe.nudge()
        runCurrent()
        assertEquals(2, calls)
        probe.stop()
    }
}
