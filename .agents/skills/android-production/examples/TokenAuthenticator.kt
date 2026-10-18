package com.tran.voting.core.network

import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/**
 * Thread-safe OkHttp Authenticator to coordinate token refresh and prevent retry loops.
 * Inspired by `bitwarden/android` (`network/`).
 */
class TokenAuthenticator(
    private val tokenProvider: TokenProvider,
    private val tokenRefreshClient: TokenRefreshClient
) : Authenticator {

    private val lock = Any()

    override fun authenticate(route: Route?, response: Response): Request? {
        // Prevent infinite loops if server keeps returning 401
        if (responseCount(response) >= 3) {
            return null
        }

        val staleToken = tokenProvider.getAccessToken()

        synchronized(lock) {
            val currentToken = tokenProvider.getAccessToken()

            // Check if another concurrent request has already refreshed the token
            val validToken = if (currentToken != null && currentToken != staleToken) {
                currentToken
            } else {
                val refreshToken = tokenProvider.getRefreshToken() ?: return null
                val refreshResponse = tokenRefreshClient.refreshToken(refreshToken)
                if (refreshResponse != null) {
                    tokenProvider.saveTokens(
                        accessToken = refreshResponse.newAccessToken,
                        refreshToken = refreshResponse.newRefreshToken
                    )
                    refreshResponse.newAccessToken
                } else {
                    tokenProvider.clearTokens()
                    return null
                }
            }

            return response.request.newBuilder()
                .header("Authorization", "Bearer $validToken")
                .build()
        }
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }
}

interface TokenProvider {
    fun getAccessToken(): String?
    fun getRefreshToken(): String?
    fun saveTokens(accessToken: String, refreshToken: String?)
    fun clearTokens()
}

interface TokenRefreshClient {
    fun refreshToken(refreshToken: String): RefreshTokenResult?
}

data class RefreshTokenResult(
    val newAccessToken: String,
    val newRefreshToken: String?
)
