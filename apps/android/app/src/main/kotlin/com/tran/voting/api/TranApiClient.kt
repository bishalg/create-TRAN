// Verifies: REQ-NAT-011 REQ-ERR-004 REQ-ERR-005 REQ-ROB-010
package com.tran.voting.api

import com.tran.voting.BuildConfig
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
import uniffi.tran_uniffi.errorCodeForHttpStatus
import uniffi.tran_uniffi.errorCodeFromWire
import uniffi.tran_uniffi.errorSpec
import uniffi.tran_uniffi.isValidRequestId
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
        fun rejected(response: Response): TranRequestFailure {
            val envelope = envelope(response.body.string())
            val status = response.code
            val code = envelope?.code?.let { errorCodeFromWire(it) }
                ?: errorCodeForHttpStatus(status.coerceIn(0, 65535).toUShort())
            val requestId = envelope?.requestId ?: response.header("x-request-id")
            return TranRequestFailure(
                code = code,
                status = status,
                requestId = requestId?.takeIf { isValidRequestId(it) },
                retryAfterDelayMs = response.header("retry-after")?.let { retryAfterMs(it) }?.toLong(),
            )
        }

        /** No HTTP answer: a timeout, a cancellation, or no route to the server. */
        fun classify(error: Throwable): TranRequestFailure = when (error) {
            is TranRequestFailure -> error
            is CancellationException -> TranRequestFailure(TranErrorCode.REQUEST_CANCELLED, cause = error)
            is InterruptedIOException -> TranRequestFailure(TranErrorCode.NETWORK_TIMEOUT, cause = error)
            is IOException -> TranRequestFailure(TranErrorCode.NETWORK_OFFLINE, cause = error)
            else -> TranRequestFailure(TranErrorCode.CLIENT_UNEXPECTED, cause = error)
        }
    }
}

/** Only a failure the catalogue shows as a banner (no answer at all) is "offline". */
fun tranApiStatusFrom(failure: TranRequestFailure): TranApiStatus =
    if (failure.spec.presentation is TranPresentation.Banner) TranApiStatus.OFFLINE else TranApiStatus.ONLINE

/** Retries retryable failures of idempotent calls on the Rust schedule (REQ-ERR-005). */
class TranRetry(
    /** Injected in tests so the backoff never really waits. */
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val random: () -> Double = { Random.nextDouble() },
) {
    suspend fun <T> run(idempotent: Boolean, call: suspend () -> T): T {
        val maxAttempts = retryPolicy().maxAttempts
        var attempt = 1u
        while (true) {
            try {
                return call()
            } catch (error: Exception) {
                val failure = TranRequestFailure.classify(error)
                if (failure.code == TranErrorCode.REQUEST_CANCELLED && error is CancellationException) throw error
                if (!idempotent || !failure.spec.retryable || attempt >= maxAttempts) throw failure
                sleep(failure.retryAfterDelayMs ?: retryDelayMs(attempt, random()).toLong())
                attempt += 1u
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
    private val baseUrl: String = TranApiConfig.baseUrl,
    private val includeDebugCountry: Boolean = TranApiConfig.includeDebugCountry,
    private val http: OkHttpClient = sharedHttpClient,
    private val retry: TranRetry = TranRetry(),
    /** Where the blocking call runs; a JVM screenshot test passes `Unconfined` to stay on one thread. */
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    suspend fun checkHealth() {
        retry.run(idempotent = true) {
            send(path = "/api/health", method = "GET", body = null, countryCode = null)
        }
    }

    /** A pure computation on the server, so it is safe to retry. */
    suspend fun confirmEligibility(age: Int, countryCode: String) {
        retry.run(idempotent = true) {
            send(
                path = "/api/vote/eligibility",
                method = "POST",
                body = """{"age":$age}""",
                countryCode = countryCode,
            )
        }
    }

    private suspend fun send(path: String, method: String, body: String?, countryCode: String?) {
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .method(method, body?.toRequestBody(JSON))
            .header("Accept", "application/json")
            .apply {
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
                throw TranRequestFailure.classify(error)
            }
            response.use { if (!it.isSuccessful) throw TranRequestFailure.rejected(it) }
        }
    }

    companion object {
        private val JSON = "application/json".toMediaType()
        private val COUNTRY_CODE = Regex("^[A-Za-z]{2}$")

        /** Shared so screens never build a connection pool per recomposition. */
        /** The catalogue's per-attempt timeout: a status pill must never make the dashboard feel stuck. */
        private val sharedHttpClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(2, TimeUnit.SECONDS)
                .callTimeout(retryPolicy().requestTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
                .build()
        }
    }
}
