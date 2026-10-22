// Verifies: REQ-LOAD-002 REQ-LOAD-004 REQ-LOAD-005
package com.tran.voting.api

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import uniffi.tran_uniffi.TranPresentation
import uniffi.tran_uniffi.TranVerdictSource
import uniffi.tran_uniffi.loadingPolicy
import uniffi.tran_uniffi.verdictSourceSpec

/**
 * Owns the background server confirmation that follows a device verdict (ADR-0023, ADR-0035):
 * one [Job] at a time, the newest start wins, and a cancelled run changes nothing and reports
 * nothing (REQ-LOAD-004). The indicator turns on only once a run has outlived the policy delay
 * (REQ-LOAD-002). Call from the main thread; [scope] is the screen's.
 */
class ServerConfirmation(
    private val scope: CoroutineScope,
    private val indicatorDelayMs: Long = loadingPolicy().indicatorDelayMs.toLong(),
) {
    /** How the current verdict's run ended; [Phase.Idle] until it settles. */
    sealed interface Phase {
        data object Idle : Phase

        data object Confirmed : Phase

        data class Failed(val failure: TranRequestFailure) : Phase
    }

    var phase: Phase by mutableStateOf(Phase.Idle)
        private set

    /** True only while a run is in flight past the indicator delay. */
    var isPending: Boolean by mutableStateOf(false)
        private set

    private var job: Job? = null

    /**
     * Who vouched for the verdict on screen (REQ-LOAD-005): the server once it answered; the
     * device as a fallback when the server could not answer (no answer at all, or a retryable
     * failure after the retries); otherwise the device alone.
     */
    val source: TranVerdictSource
        get() = when (val current = phase) {
            Phase.Idle -> TranVerdictSource.DEVICE
            Phase.Confirmed -> TranVerdictSource.SERVER
            is Phase.Failed -> {
                val spec = current.failure.spec
                if (spec.presentation is TranPresentation.Banner || spec.retryable) {
                    TranVerdictSource.DEVICE_FALLBACK
                } else {
                    TranVerdictSource.DEVICE
                }
            }
        }

    /** Locale key of the verdict's live caption: the pending copy while pending, else the source label. */
    val captionKey: String
        get() = if (isPending) loadingPolicy().pendingMessageKey else verdictSourceSpec(source).messageKey

    /**
     * Cancels the run in flight and starts [run]. The source goes back to the device at once: the
     * previous answer does not vouch for the new device verdict (REQ-LOAD-005). [onSettled]
     * receives the classified failure, or `null` on success — never for a cancelled run.
     */
    fun start(run: suspend () -> Unit, onSettled: (TranRequestFailure?) -> Unit = {}) {
        cancel()
        phase = Phase.Idle
        job = scope.launch {
            val indicator = launch {
                delay(indicatorDelayMs)
                isPending = true
            }
            val failure = try {
                run()
                null
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                TranRequestFailure.classify(error)
            }
            indicator.cancel()
            isPending = false
            phase = failure?.let(Phase::Failed) ?: Phase.Confirmed
            onSettled(failure)
        }
    }

    /** Leaving the screen: drop the run in flight; the phase and source stay as they were. */
    fun cancel() {
        job?.cancel()
        job = null
        isPending = false
    }
}
