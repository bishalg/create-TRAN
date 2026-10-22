package com.tran.voting.testing

import com.tran.voting.api.TranApiClient
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/**
 * Fake transports for the JVM Compose tests (Robolectric). Every call stays on the calling thread
 * (`Unconfined`) unless it must hang: a hop to `Dispatchers.IO` and back to Robolectric's main
 * thread lost about one resume in fifty (docs/LEARNINGS.md, 2026-10-21).
 */
object FakeApis {
    private const val ELIGIBILITY = "/api/vote/eligibility"

    /** Answers every request with an empty 200, at once — the status pill shows "online". */
    fun healthy(answered: AtomicInteger = AtomicInteger()): TranApiClient =
        client(Dispatchers.Unconfined) { chain ->
            answered.incrementAndGet()
            ok(chain)
        }

    /** Every request fails with no answer at all (`network.offline`, a banner). */
    fun refusing(): TranApiClient = client(Dispatchers.Unconfined) { throw IOException("connection refused") }

    /**
     * Answers health at once; holds the eligibility call open until [Hang.release], then answers
     * it with a 200. Only the held call leaves the main thread: blocking it would freeze the
     * screen under test.
     */
    fun hanging(hang: Hang): TranApiClient =
        client(hang.dispatcher) { chain ->
            if (chain.request().url.encodedPath == ELIGIBILITY) {
                hang.held.incrementAndGet()
                hang.latch.await(HANG_LIMIT_S, TimeUnit.SECONDS)
                hang.answered.incrementAndGet()
            }
            ok(chain)
        }

    /** A held request and the switch that moves only it off the main thread. */
    class Hang {
        internal val latch = CountDownLatch(1)
        internal val held = AtomicInteger()
        internal val answered = AtomicInteger()

        /** Inline (like `Unconfined`) until [offMainThread] — then `Dispatchers.IO`. */
        internal val dispatcher = object : CoroutineDispatcher() {
            override fun isDispatchNeeded(context: CoroutineContext): Boolean = offMainThread

            override fun dispatch(context: CoroutineContext, block: Runnable) =
                Dispatchers.IO.dispatch(context, block)
        }

        /** Flip after the startup health check has answered, before the call that should hang. */
        @Volatile
        var offMainThread = false

        /** Requests that reached the hang. */
        val heldRequests: Int get() = held.get()

        /** Held requests answered after [release]. */
        val answeredRequests: Int get() = answered.get()

        /** Ends every held request (call from `@After`, so no worker thread outlives the test). */
        fun release() = latch.countDown()
    }

    private const val HANG_LIMIT_S = 60L

    private fun ok(chain: Interceptor.Chain): Response =
        Response.Builder()
            .request(chain.request())
            .protocol(Protocol.HTTP_1_1)
            .code(200)
            .message("OK")
            .body("{}".toResponseBody("application/json".toMediaType()))
            .build()

    private fun client(io: CoroutineDispatcher, interceptor: Interceptor): TranApiClient =
        TranApiClient(
            baseUrl = "http://api.test",
            includeDebugCountry = false,
            http = OkHttpClient.Builder().addInterceptor(interceptor).build(),
            io = io,
        )
}
