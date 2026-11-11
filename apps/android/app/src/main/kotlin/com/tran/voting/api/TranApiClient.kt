// Verifies: REQ-NAT-011 REQ-ERR-004 REQ-ERR-005 REQ-ROB-010 REQ-VER-001 REQ-VER-004 REQ-OBS-010 REQ-OBS-011
package com.tran.voting.api

import com.tran.voting.BuildConfig
import com.tran.voting.generated.ApiContract
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit
import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranErrorSpec
import uniffi.tran_uniffi.TranPresentation
import uniffi.tran_uniffi.childSpanOffline
import uniffi.tran_uniffi.errorCodeForHttpStatus
import uniffi.tran_uniffi.errorCodeFromWire
import uniffi.tran_uniffi.errorSpec
import uniffi.tran_uniffi.formatTraceparentOffline
import uniffi.tran_uniffi.isValidRequestId
import uniffi.tran_uniffi.newTraceOffline
import uniffi.tran_uniffi.parseTraceparentOffline
import uniffi.tran_uniffi.retryAfterMs
import uniffi.tran_uniffi.retryDelayMs
import uniffi.tran_uniffi.retryPolicy

/** Status pill states — the same vocabulary as the web footer (`shell.status.*`). */
enum class TranApiStatus { CHECKING, ONLINE, OFFLINE }

/**
 * Every failure the client sees, classified against the Rust catalogue (REQ-ERR-004). Users see
 * the catalogue message for [code], never a server or system message.
 */
class TranRequestFailure(
    val code: TranErrorCode,
    val status: Int? = null,
    val requestId: String? = null,
    val traceId: String? = null,
    /** The server's `Retry-After`, already capped by the catalogue. */
    val retryAfterDelayMs: Long? = null,
    cause: Throwable? = null,
) : Exception("request failed: $code", cause) {
    val spec: TranErrorSpec get() = errorSpec(code)

    companion object {
        /** The fields of an API envelope that a client reads. */
        private class Envelope(val code: String?, val requestId: String?)

        /**
         * The body as an envelope, or `null` — ignored as a whole — unless it is a JSON object with
         * `success: false`, a string `error`, and correctly typed optional fields (REQ-ROB-010),
         * exactly like the web's Zod schema and Swift's `Decodable`.
         */
        private fun envelope(body: String): Envelope? {
            val json = try {
                JSONTokener(body).nextValue() as? JSONObject
            } catch (_: JSONException) {
                null
            } ?: return null
            val valid = json.opt("success") == false && json.opt("error") is String &&
                json.isAbsentOr<String>("code") && json.isAbsentOr<Boolean>("retryable") &&
                json.isAbsentOr<String>("request_id")
            return if (valid) Envelope(json.stringOrNull("code"), json.stringOrNull("request_id")) else null
        }

        private inline fun <reified T> JSONObject.isAbsentOr(key: String) = !has(key) || get(key) is T

        private fun JSONObject.stringOrNull(key: String) = if (has(key)) getString(key) else null

        /**
         * The envelope's `code` when the body is one, else the catalogue's status fallback table. A
         * request id that is not log-safe is dropped (REQ-ROB-010).
         */
        fun rejected(response: Response, traceId: String? = null): TranRequestFailure {
            val envelope = envelope(response.body.string())
            val status = response.code
            val code = envelope?.code?.let { errorCodeFromWire(it) }
                ?: errorCodeForHttpStatus(status.coerceIn(0, 65535).toUShort())
            val requestId = envelope?.requestId ?: response.header("x-request-id")
            return TranRequestFailure(
                code = code,
                status = status,
                requestId = requestId?.takeIf { isValidRequestId(it) },
                traceId = traceId,
                retryAfterDelayMs = response.header("retry-after")?.let { retryAfterMs(it) }?.toLong(),
            )
        }

        /** No HTTP answer: a timeout, a cancellation, or no route to the server. */
        fun classify(error: Throwable, traceId: String? = null): TranRequestFailure = when (error) {
            is TranRequestFailure -> if (error.traceId == null && traceId != null) TranRequestFailure(
                error.code, error.status, error.requestId, traceId, error.retryAfterDelayMs, error.cause
            ) else error
            is CancellationException -> TranRequestFailure(TranErrorCode.REQUEST_CANCELLED, traceId = traceId, cause = error)
            is InterruptedIOException -> TranRequestFailure(TranErrorCode.NETWORK_TIMEOUT, traceId = traceId, cause = error)
            is IOException -> TranRequestFailure(TranErrorCode.NETWORK_OFFLINE, traceId = traceId, cause = error)
            else -> TranRequestFailure(TranErrorCode.CLIENT_UNEXPECTED, traceId = traceId, cause = error)
        }
    }
}

/** Only a failure the catalogue shows as a banner (no answer at all) is "offline". */
fun tranApiStatusFrom(failure: TranRequestFailure): TranApiStatus =
    if (failure.spec.presentation is TranPresentation.Banner) TranApiStatus.OFFLINE else TranApiStatus.ONLINE

/** Retries retryable failures of idempotent calls on the Rust schedule (REQ-ERR-005, REQ-OBS-010). */
class TranRetry(
    /** Injected in tests so the backoff never really waits. */
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val random: () -> Double = { Random.nextDouble() },
) {
    suspend fun <T> run(
        idempotent: Boolean,
        traceId: String? = null,
        call: suspend (traceparent: String?) -> T
    ): T {
        val maxAttempts = retryPolicy().maxAttempts
        val tid = traceId ?: newTraceId()
        var attempt = 1u
        while (true) {
            val tp = newChildTraceparent(tid)
            try {
                return call(tp)
            } catch (error: Exception) {
                val failure = TranRequestFailure.classify(error, traceId = tid)
                if (failure.code == TranErrorCode.REQUEST_CANCELLED && error is CancellationException) throw error
                if (!idempotent || !failure.spec.retryable || attempt >= maxAttempts) throw failure
                sleep(failure.retryAfterDelayMs ?: retryDelayMs(attempt, random()).toLong())
                attempt += 1u
            }
        }
    }

    companion object {
        /** The system's secure random source; a test passes one that fails. */
        val secureRandom: (ByteArray) -> Unit = { java.security.SecureRandom().nextBytes(it) }

        /**
         * A new trace id, or `null` when no randomness is available: the call then goes without a
         * `traceparent` and the server starts the trace. A made-up constant id would merge unrelated
         * traces (REQ-OBS-010).
         */
        fun newTraceId(random: (ByteArray) -> Unit = secureRandom): String? {
            val bytes = ByteArray(24)
            return try {
                random(bytes)
                newTraceOffline(bytes, true)?.traceId
            } catch (_: RuntimeException) {
                null
            }
        }

        /** A `traceparent` with a new span of [traceId], or `null` (no trace, or no randomness): none is sent. */
        fun newChildTraceparent(traceId: String?, random: (ByteArray) -> Unit = secureRandom): String? {
            if (traceId == null) return null
            val bytes = ByteArray(8)
            return try {
                random(bytes)
                childSpanOffline(traceId, bytes, true)?.let { formatTraceparentOffline(it) }
            } catch (_: RuntimeException) {
                null
            }
        }
    }
}

/** Build-time configuration (REQ-NAT-011, ADR-0023). */
object TranApiConfig {
    /** From `-PtranApiBaseUrl` / `TRAN_API_BASE_URL`, else `http://10.0.2.2:3001` (debug). */
    val baseUrl: String = BuildConfig.TRAN_API_BASE_URL

    /** The dev-only `X-Debug-Country` header is never sent by a release build. */
    val includeDebugCountry: Boolean = BuildConfig.DEBUG
}

/**
 * Thin client for the Axum API: the device verdict is the product (REQ-NAT-002), so the response
 * body is not parsed — the call only confirms the API is reachable and agrees.
 */
class TranApiClient(
    // Internal: a device-only session's account calls go to the same server the same way (`SessionClient.deviceOnly`).
    internal val baseUrl: String = TranApiConfig.baseUrl,
    private val includeDebugCountry: Boolean = TranApiConfig.includeDebugCountry,
    http: OkHttpClient = sharedHttpClient,
    private val retry: TranRetry = TranRetry(),
    /** Where the blocking call runs; a JVM screenshot test passes `Unconfined` to stay on one thread. */
    internal val io: CoroutineDispatcher = Dispatchers.IO,
    /** What this client's answers say about the app version (spec 028); the coordinator reads it. */
    val standing: ClientStanding = ClientStanding(),
) {
    /** The transport as given; the session client wraps it the same way. */
    internal val transport: OkHttpClient = http

    /** [transport] behind the client header and the standing (REQ-VER-004). */
    private val http: OkHttpClient = http.tranClient(standing)

    suspend fun checkHealth(traceId: String? = null) {
        retry.run(idempotent = true, traceId = traceId) { tp ->
            send(path = ApiContract.healthPath, method = "GET", body = null, countryCode = null, traceparent = tp)
        }
    }

    /** One health request without retries: the recovery probe's question (REQ-ERR-013). */
    suspend fun probeHealth(traceId: String? = null) {
        val tid = traceId ?: TranRetry.newTraceId()
        val tp = TranRetry.newChildTraceparent(tid)
        send(path = ApiContract.healthPath, method = "GET", body = null, countryCode = null, traceparent = tp)
    }

    /** A pure computation on the server, so it is safe to retry. */
    suspend fun confirmEligibility(age: Int, countryCode: String, traceId: String? = null) {
        retry.run(idempotent = true, traceId = traceId) { tp ->
            send(
                path = ELIGIBILITY_PATH,
                method = "POST",
                body = """{"age":$age}""",
                countryCode = countryCode,
                traceparent = tp,
            )
        }
    }

    private suspend fun send(
        path: String,
        method: String,
        body: String?,
        countryCode: String?,
        traceparent: String? = null,
    ) {
        val tp = traceparent ?: TranRetry.newChildTraceparent(TranRetry.newTraceId())
        val traceId = tp?.let { parseTraceparentOffline(it)?.traceId }
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .method(method, body?.toRequestBody(JSON))
            .header("Accept", "application/json")
            .apply {
                if (tp != null) header("traceparent", tp)
                if (body != null) header("Content-Type", "application/json")
                if (includeDebugCountry && countryCode != null && countryCode.matches(COUNTRY_CODE)) {
                    header("X-Debug-Country", countryCode.uppercase())
                }
            }
            .build()

        withContext(io) {
            val response = try {
                http.newCall(request).execute()
            } catch (error: IOException) {
                throw TranRequestFailure.classify(error, traceId = traceId)
            }
            response.use { if (!it.isSuccessful) throw TranRequestFailure.rejected(it, traceId = traceId) }
        }
    }

    companion object {
        private val JSON = "application/json".toMediaType()
        private val COUNTRY_CODE = Regex("^[A-Za-z]{2}$")
        private const val ELIGIBILITY_PATH = ApiContract.basePath + "/vote/eligibility"

        /**
         * Shared so screens never build a connection pool per recomposition; the session client
         * uses it too. The catalogue's per-attempt timeout: a status pill must never make the
         * dashboard feel stuck.
         */
        internal val sharedHttpClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(2, TimeUnit.SECONDS)
                .callTimeout(retryPolicy().requestTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
                .build()
        }
    }
}
