// Verifies: REQ-ERR-011 REQ-ERR-014
package com.tran.voting.ui.feedback

import com.tran.voting.api.TranRequestFailure
import java.util.concurrent.atomic.AtomicBoolean
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.isReportedLogLevel

/**
 * The one seam for "a human must look at this" (ADR-0036): `error`-level failures and uncaught
 * exceptions go to [sink] — Crashlytics, Sentry or an HTTP endpoint in a real app; none in the
 * template, so nothing leaves the device.
 */
object TranReporting {
    /** Exactly the `logEvent` fields — never a payload. */
    data class Event(val code: String, val status: Int?, val requestId: String?)

    /** Set once at startup; read from any thread, including the crashing one. */
    @Volatile
    var sink: ((Event, Throwable?) -> Unit)? = null

    /** Reports [failure] when the catalogue logs it at `error`; anything quieter is never reported. */
    fun report(failure: TranRequestFailure) {
        val spec = failure.spec
        if (!isReportedLogLevel(spec.logLevel)) return
        // Only client-side codes carry the thrown value (for its stack), never a payload.
        val cause = failure.cause.takeIf { spec.wireCode.startsWith("client.") }
        runCatching { sink?.invoke(Event(spec.wireCode, failure.status, failure.requestId), cause) }
    }

    /**
     * Reports an uncaught exception as `client.unexpected`, then hands it to the previous handler,
     * which ends the process (REQ-ERR-011). Compose cannot recover a broken composition, so there is
     * no `screen` presentation on Android.
     */
    fun installUncaughtExceptionHandler() {
        // Once per process: `onCreate` runs again on every rotation, and a second wrapper would
        // report each crash twice.
        if (!installed.compareAndSet(false, true)) return
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            // Reporting may itself fail (the crash can be the native library failing to load); the
            // previous handler must still run, or the process hangs instead of ending.
            try {
                report(TranRequestFailure(TranErrorCode.CLIENT_UNEXPECTED, cause = error))
            } catch (_: Throwable) {
            } finally {
                previous?.uncaughtException(thread, error)
            }
        }
    }

    private val installed = AtomicBoolean(false)
}
