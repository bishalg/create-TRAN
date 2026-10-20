// Verifies: REQ-NAT-011
package com.tran.voting.api

import com.tran.voting.BuildConfig
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Status pill states — the same vocabulary as the web footer (`shell.status.*`). */
enum class TranApiStatus { CHECKING, ONLINE, OFFLINE }

/**
 * Why a call failed. Only [Offline] means "the server could not be reached" — a rejection means it
 * answered, mirroring the web's `isNetworkError` split.
 */
sealed class TranApiError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class Offline(cause: Throwable? = null) : TranApiError("API unreachable", cause)

    class Rejected(val status: Int) : TranApiError("API answered with $status")
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
) {
    suspend fun checkHealth() {
        send(path = "/api/health", method = "GET", body = null, countryCode = null)
    }

    suspend fun confirmEligibility(age: Int, countryCode: String) {
        send(
            path = "/api/vote/eligibility",
            method = "POST",
            body = """{"age":$age}""",
            countryCode = countryCode,
        )
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

        withContext(Dispatchers.IO) {
            try {
                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) throw TranApiError.Rejected(response.code)
                }
            } catch (error: IOException) {
                throw TranApiError.Offline(error)
            }
        }
    }

    companion object {
        private val JSON = "application/json".toMediaType()
        private val COUNTRY_CODE = Regex("^[A-Za-z]{2}$")

        /** Shared so screens never build a connection pool per recomposition. */
        private val sharedHttpClient: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .build()
    }
}

/** Maps a call outcome to the status pill: a rejection means the server answered. */
fun tranApiStatusFrom(error: Throwable): TranApiStatus =
    if (error is TranApiError.Rejected) TranApiStatus.ONLINE else TranApiStatus.OFFLINE
