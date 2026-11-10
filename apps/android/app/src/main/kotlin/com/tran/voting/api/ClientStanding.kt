// Verifies: REQ-VER-004 REQ-VER-009 REQ-VER-010
package com.tran.voting.api

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.tran.voting.BuildConfig
import com.tran.voting.generated.ApiContract
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import uniffi.tran_uniffi.TranClientPlatform
import uniffi.tran_uniffi.formatClient

/** The API recommends a newer app version, naming it when it can (`X-Tran-Recommended-Version`). */
data class UpdateRecommendation(val version: String?)

/**
 * What the API's answers said about this app version (spec 028), read by `NavigationCoordinator`:
 * a `426` from any product route blocks the app behind the update screen for good (REQ-VER-009);
 * `X-Tran-Update: recommended` offers the dismissible prompt (REQ-VER-010). Compose state, so the
 * screen follows; written from OkHttp's threads, which snapshot state allows.
 */
class ClientStanding {
    /** Set by the first `426`; nothing lifts it, not even a later nudge: only an update does. */
    var upgradeRequired: Boolean by mutableStateOf(false)
        private set

    /** The latest recommendation; it changes only when the recommended version does. */
    var recommendation: UpdateRecommendation? by mutableStateOf(null)
        private set

    /** Reads one answer of [path]. Health is unversioned and never blocks (REQ-VER-005). */
    fun observe(path: String, response: Response) {
        if (!path.startsWith(ApiContract.basePath + "/")) return
        if (response.code == UPGRADE_REQUIRED) {
            upgradeRequired = true
        } else if (response.header(ApiContract.updateHeader) == ApiContract.updateRecommended) {
            val next = UpdateRecommendation(response.header(ApiContract.recommendedVersionHeader))
            if (next != recommendation) recommendation = next
        }
    }

    private companion object {
        const val UPGRADE_REQUIRED = 426
    }
}

/**
 * The one place every API request passes (REQ-VER-004): it names the app with `X-Tran-Client:
 * android/<versionName>` and hands each answer to [standing]. Both API clients put it first on
 * whatever OkHttp client they are given ([tranClient]), so a test transport sees the header too.
 */
class TranClientInterceptor(
    private val standing: ClientStanding?,
    private val client: String = TranClientIdentity.header,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder().header(ApiContract.clientHeader, client).build()
        val response = chain.proceed(request)
        standing?.observe(request.url.encodedPath, response)
        return response
    }
}

/** This app as the API knows it: the Rust formatter over the version `pnpm release` writes. */
object TranClientIdentity {
    val header: String by lazy { formatClient(TranClientPlatform.ANDROID, BuildConfig.VERSION_NAME) }
}

/**
 * [this] client with [TranClientInterceptor] first, so it runs before any interceptor that answers
 * without the network (the JVM tests' fakes). Shares the connection pool and dispatcher.
 */
fun OkHttpClient.tranClient(standing: ClientStanding?): OkHttpClient =
    newBuilder().apply { interceptors().add(0, TranClientInterceptor(standing)) }.build()
