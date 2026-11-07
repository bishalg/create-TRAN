// Verifies: REQ-ERR-013
package com.tran.voting.api

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import uniffi.tran_uniffi.recoveryProbeDelayMs

/**
 * Asks the server whether it is back while a connectivity banner is up (REQ-ERR-013): on the Rust
 * schedule (`recoveryProbeDelayMs`), and at once on [nudge] — the network returned or the app came
 * to the foreground. One probe at a time, no retries; [stop] silences a probe in flight.
 */
class RecoveryProbe(
    private val scope: CoroutineScope,
    /** Injected in tests so the schedule never really waits (same shape as `TranRetry.sleep`). */
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    private var job: Job? = null
    private var probe: (suspend () -> Unit)? = null
    private var onRecovered: (() -> Unit)? = null
    private var probes = 0
    private var probing = false
    /** Bumped by every start and stop; a probe from an older run may not touch the state. */
    private var generation = 0

    /** Whether a recovery is under way (a probe is scheduled or in flight). */
    val isRunning: Boolean get() = probe != null

    /** Starts probing with [probe]; [onRecovered] runs once, after the first probe that succeeds. */
    fun start(probe: suspend () -> Unit, onRecovered: () -> Unit) {
        stop()
        this.probe = probe
        this.onRecovered = onRecovered
        probes = 0
        schedule()
    }

    /** Probes now, unless a probe is already in flight or nothing is being recovered. */
    fun nudge() {
        if (probe == null || probing) return
        job?.cancel()
        job = scope.launch { runProbe() }
    }

    /** Stops probing; a probe in flight is cancelled and changes nothing. */
    fun stop() {
        generation += 1
        job?.cancel()
        job = null
        probe = null
        onRecovered = null
        probing = false
    }

    private fun schedule() {
        val wait = recoveryProbeDelayMs((probes + 1).toUInt()).toLong()
        job = scope.launch {
            sleep(wait)
            runProbe()
        }
    }

    private suspend fun runProbe() {
        val current = probe ?: return
        val run = generation
        probing = true
        probes += 1
        val succeeded = try {
            current()
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            false
        } finally {
            // An older run (stopped while its request unwound) must not clear a newer run's flag.
            if (run == generation) probing = false
        }
        if (run != generation) return
        if (succeeded) {
            val recovered = onRecovered
            stop()
            recovered?.invoke()
        } else {
            schedule()
        }
    }
}
