# Android Networking & Result Architecture Guide

This guide establishes the network client architecture for Android apps based on **Now in Android (`core/network`)** and **Bitwarden Android (`network/`)**.

---

## 1. Thread-Safe Token Refresh via OkHttp Authenticator

When multiple asynchronous requests fail concurrently with `401 Unauthorized`, an un-synchronized authenticator will fire multiple refresh calls, invalidating session tokens. Use synchronization to coordinate a single refresh:

```kotlin
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import java.util.concurrent.atomic.AtomicBoolean

class TokenAuthenticator(
    private val tokenStorage: TokenStorage,
    private val authService: TokenRefreshApi
) : Authenticator {

    private val isRefreshing = AtomicBoolean(false)
    private val lock = Any()

    override fun authenticate(route: Route?, response: Response): Request? {
        // Prevent infinite loops if refresh token itself returns 401
        if (responseCount(response) >= 3) {
            return null
        }

        val currentToken = tokenStorage.getAccessToken()

        synchronized(lock) {
            val latestToken = tokenStorage.getAccessToken()

            // If another thread already refreshed the token, retry with the new token immediately
            val tokenToUse = if (latestToken != currentToken && latestToken != null) {
                latestToken
            } else {
                val refreshResult = authService.refreshTokenSync(tokenStorage.getRefreshToken())
                if (refreshResult.isSuccessful) {
                    val newToken = refreshResult.body()?.accessToken ?: return null
                    tokenStorage.saveTokens(newToken, refreshResult.body()?.refreshToken)
                    newToken
                } else {
                    tokenStorage.clearTokens()
                    return null
                }
            }

            return response.request.newBuilder()
                .header("Authorization", "Bearer $tokenToUse")
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
```

---

## 2. Kotlin Functional Result Extensions

Inspired by **Proton Pass Android (`pass/common`)**, clean functional extensions simplify error handling across repository layers:

```kotlin
inline fun <T, R> Result<T>.flatMap(transform: (T) -> Result<R>): Result<R> {
    return fold(
        onSuccess = { transform(it) },
        onFailure = { Result.failure(it) }
    )
}

suspend fun <T> safeApiCall(apiCall: suspend () -> T): Result<T> {
    return try {
        Result.success(apiCall())
    } catch (e: Exception) {
        Result.failure(e)
    }
}
```
