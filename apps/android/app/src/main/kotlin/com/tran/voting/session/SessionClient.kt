// Verifies: REQ-SEC-014 REQ-SEC-015 REQ-SEC-016 REQ-SEC-017 REQ-SEC-022 REQ-ACC-006 REQ-PSH-011
// Verifies: REQ-VER-001 REQ-VER-004 REQ-VER-008 REQ-OBS-010 REQ-OBS-011
package com.tran.voting.session

import com.tran.voting.api.ClientStanding
import com.tran.voting.api.TranApiClient
import com.tran.voting.api.TranApiConfig
import com.tran.voting.api.TranRequestFailure
import com.tran.voting.api.TranRetry
import com.tran.voting.api.tranClient
import com.tran.voting.generated.ApiContract
import com.tran.voting.ui.feedback.TranFeedback
import com.tran.voting.ui.feedback.tranLogcat
import uniffi.tran_uniffi.parseTraceparentOffline
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONException
import org.json.JSONObject
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranSessionAction
import uniffi.tran_uniffi.TranSessionEvent
import uniffi.tran_uniffi.TranUserRole
import uniffi.tran_uniffi.sessionRecovery
import uniffi.tran_uniffi.sessionRefreshEvent

/**
 * A session this device has already forgotten, held only for the sign-out's last calls. It prints
 * no credential (REQ-SEC-014).
 */
class EndedSession(val refreshToken: String?, internal val accessToken: String?) {
    override fun toString(): String = "EndedSession(redacted)"
}

/** Who the API says is signed in. */
data class SessionUser(val userId: String, val role: TranUserRole)

/** A sign-in or refresh answer: what the client keeps of it. Prints no credential (REQ-SEC-014). */
internal class SessionToken(val user: SessionUser, val accessToken: String, val refreshToken: String) {
    override fun toString(): String = "SessionToken(redacted)"
}

/**
 * The native half of the API session (spec 022, ADR-0039): the body transport, the refresh token in
 * the [vault], the access token in this object's memory only (REQ-SEC-017).
 *
 * An explicit suspend wrapper rather than an OkHttp `Authenticator`: one coroutine-shared refresh
 * and the Rust `sessionRecovery` decision stay in plain, testable code instead of OkHttp's threads.
 *
 * No token is ever logged: log lines are `TranFeedback.logLine` (code, status, request id only).
 * One event per failure (REQ-ROB-007): a failure this client throws is the caller's to log and
 * present (`TranFeedback.report` or `log`); only one it swallows (the sign-out revoke) is logged here.
 */
class SessionClient(
    private val vault: SessionVault,
    private val baseUrl: String = TranApiConfig.baseUrl,
    http: OkHttpClient = TranApiClient.sharedHttpClient,
    /** Where the blocking calls run; tests pass `Unconfined` or keep the default. */
    private val io: CoroutineDispatcher = Dispatchers.IO,
    /** TranFeedback's logger with `logLine` fields only; injected in JVM tests, where `android.util.Log` is unavailable. */
    private val log: (TranLogLevel, String) -> Unit = ::tranLogcat,
    /** Told what each answer says about the app version (spec 028): the app passes its API client's. */
    standing: ClientStanding? = null,
) {
    /** [http] behind the client header and the standing (REQ-VER-004). */
    private val http: OkHttpClient = http.tranClient(standing)

    @Volatile
    private var accessToken: String? = null

    private val lock = Any()
    private var inFlight: CompletableDeferred<RefreshOutcome>? = null
    private var deletion: CompletableDeferred<Throwable?>? = null

    /** Whether an access token is held in memory (never exposed itself). */
    val hasAccessToken: Boolean get() = accessToken != null

    /** Whether there is an API session to authenticate a call with: an access token, or a stored refresh token. */
    val hasSession: Boolean get() = accessToken != null || vault.read() != null

    /**
     * `PUT /api/devices/{installation_id}` (spec 027): registers this installation's push token to
     * the signed-in user and this session, refreshing once if needed. [body] is the documented
     * registration; the caller logs a failure.
     */
    suspend fun registerDevice(installationId: String, body: JSONObject) {
        authorized { Request.Builder().url(url(devicePath(installationId))).put(body.toString().toRequestBody(JSON)) }
    }

    /** `DELETE /api/devices/{installation_id}` with the live session, refreshing once if needed. */
    suspend fun unregisterDevice(installationId: String) {
        authorized { Request.Builder().url(url(devicePath(installationId))).delete() }
    }

    /**
     * `DELETE /api/devices/{installation_id}` for a session [end] already forgot (REQ-PSH-011): one
     * attempt with the access token it held, never a refresh. Without one nothing is sent; the
     * server removes the session's registrations when it is revoked anyway (REQ-PSH-003).
     */
    suspend fun unregisterDevice(installationId: String, ended: EndedSession) {
        val token = ended.accessToken ?: return
        val request = Request.Builder().url(url(devicePath(installationId))).delete()
            .header("Authorization", "Bearer $token").build()
        send(request).failure?.let { throw it }
    }

    /**
     * `POST /api/auth/session` with the body transport (ADR-0039 decision 7: the device session is
     * already open; this establishes the API session behind it and stores it in the vault).
     */
    suspend fun signIn(role: TranUserRole, traceId: String? = null): SessionUser {
        val tid = traceId ?: TranRetry.newTraceId()
        val tp = TranRetry.newChildTraceparent(tid)
        val body = JSONObject().put("role", role.wire).put("transport", "body")
        val answer = send(post(SESSION_PATH, body).newBuilder().header("traceparent", tp).build())
        answer.failure?.let { throw it }
        return store(answer.json())
    }

    /** `GET /api/auth/session`: who the stored session belongs to, refreshing once if needed. */
    suspend fun currentUser(traceId: String? = null): SessionUser {
        val answer = authorized(traceId = traceId) { Request.Builder().url(url(SESSION_PATH)).get() }
        return decodeUser(answer.json())
    }

    /**
     * `DELETE /api/account` (spec 024, ADR-0041 decision 4): the server decides, then the device
     * follows. Only a `2xx` clears the vault and the access token; any failure is thrown with the
     * session untouched, except a `401` that Rust's `sessionRecovery` turns into a sign-out.
     *
     * Unlike other calls, a device with no credential at all still asks: its session may be one whose
     * API sign-in never landed, and only the server's `401` (not the missing token) may end it, so
     * an unreachable server keeps the user where they are.
     *
     * Single-flight (REQ-ACC-006): a call made while one is in flight sends nothing and shares its
     * outcome, so a second `DELETE` never answers `401` for an account the first one just deleted.
     */
    suspend fun deleteAccount(traceId: String? = null) {
        val (shared, owner) = synchronized(lock) {
            deletion?.let { return@synchronized it to false }
            CompletableDeferred<Throwable?>().also { deletion = it } to true
        }
        if (!owner) {
            shared.await()?.let { throw it }
            return
        }
        val outcome = try {
            authorized(askWithoutCredential = true, traceId = traceId) { Request.Builder().url(url(ACCOUNT_PATH)).delete() }
            endLocally()
            null
        } catch (failure: Throwable) {
            failure
        }
        synchronized(lock) { deletion = null }
        shared.complete(outcome)
        outcome?.let { throw it }
    }

    /**
     * Clears the vault and the access token first, then asks the server to revoke the session; the
     * server call's outcome never changes the result (REQ-SEC-022).
     */
    suspend fun signOut(traceId: String? = null) = revoke(endLocally(), traceId = traceId)

    /**
     * `POST /api/auth/sign-out` for a token [endLocally] already forgot. Best effort: it answers
     * `204` even for an unknown token, and a failure is only logged.
     */
    suspend fun revoke(refreshToken: String?, traceId: String? = null) {
        if (refreshToken == null) return
        val tid = traceId ?: TranRetry.newTraceId()
        val tp = TranRetry.newChildTraceparent(tid)
        try {
            val req = post(SIGN_OUT_PATH, JSONObject().put("refresh_token", refreshToken))
                .newBuilder()
                .header("traceparent", tp)
                .build()
            val answer = send(req)
            answer.failure?.let { logged(it) }
        } catch (failure: TranRequestFailure) {
            logged(failure)
        }
    }

    /** Forgets the session on this device at once; returns the refresh token to revoke, if any. */
    fun endLocally(): String? = end().refreshToken

    /**
     * Forgets the session on this device at once and hands back what the last calls of a sign-out
     * need: the access token for the device's own unregister, the refresh token to revoke.
     */
    fun end(): EndedSession {
        val ended = EndedSession(refreshToken = vault.read()?.refreshToken, accessToken = accessToken)
        vault.clear()
        accessToken = null
        return ended
    }

    /**
     * Sends a request with `Authorization: Bearer`; on `401` asks Rust what to do (REQ-SEC-015),
     * refreshing at most once and repeating the call once with the new token.
     * [askWithoutCredential] sends the call bare when there is neither an access nor a refresh token.
     */
    private suspend fun authorized(
        askWithoutCredential: Boolean = false,
        traceId: String? = null,
        build: () -> Request.Builder
    ): Answer {
        var retried = false
        val tid = traceId ?: TranRetry.newTraceId()
        while (true) {
            val token = accessToken
            // After a restart there is no access token: that is a 401 we need not send to learn,
            // unless the caller must hear it from the server.
            if (token != null || (askWithoutCredential && vault.read() == null)) {
                val tp = TranRetry.newChildTraceparent(tid)
                val request = build()
                    .apply { if (token != null) header("Authorization", "Bearer $token") }
                    .header("traceparent", tp)
                    .build()
                val answer = send(request)
                if (answer.failure == null) return answer
                if (answer.failure.status != UNAUTHORIZED) throw answer.failure
            }
            val event = TranSessionEvent.Unauthorized(hasRefreshCredential = vault.read() != null, alreadyRetried = retried)
            when (sessionRecovery(event)) {
                TranSessionAction.REFRESH -> when (val outcome = refresh(stale = token, traceId = tid)) {
                    is RefreshOutcome.Refreshed -> retried = true
                    is RefreshOutcome.Failed -> throw act(outcome.action, outcome.failure)
                }
                TranSessionAction.SIGN_OUT -> throw act(TranSessionAction.SIGN_OUT, expired(traceId = tid))
                TranSessionAction.KEEP -> throw expired(traceId = tid)
            }
        }
    }

    /** One shared refresh for every caller holding the same stale token (REQ-SEC-016). */
    private suspend fun refresh(stale: String?, traceId: String? = null): RefreshOutcome {
        val (deferred, owner) = synchronized(lock) {
            val current = accessToken
            if (current != null && current != stale) return RefreshOutcome.Refreshed
            inFlight?.let { return@synchronized it to false }
            CompletableDeferred<RefreshOutcome>().also { inFlight = it } to true
        }
        if (!owner) return deferred.await()
        val outcome = try {
            performRefresh(traceId)
        } catch (cancelled: CancellationException) {
            finish(deferred, RefreshOutcome.Failed(TranSessionAction.KEEP, TranRequestFailure.classify(cancelled, traceId = traceId)))
            throw cancelled
        }
        finish(deferred, outcome)
        return outcome
    }

    private fun finish(deferred: CompletableDeferred<RefreshOutcome>, outcome: RefreshOutcome) {
        synchronized(lock) { inFlight = null }
        deferred.complete(outcome)
    }

    private suspend fun performRefresh(traceId: String? = null): RefreshOutcome {
        val tid = traceId ?: TranRetry.newTraceId()
        val stored = vault.read()
            ?: return RefreshOutcome.Failed(sessionRecovery(TranSessionEvent.RefreshRejected), expired(traceId = tid))
        val tp = TranRetry.newChildTraceparent(tid)
        val answer = try {
            val req = post(REFRESH_PATH, JSONObject().put("refresh_token", stored.refreshToken))
                .newBuilder()
                .header("traceparent", tp)
                .build()
            send(req)
        } catch (failure: TranRequestFailure) {
            // No HTTP answer at all.
            val event = sessionRefreshEvent(null) ?: TranSessionEvent.RefreshFailed
            return RefreshOutcome.Failed(sessionRecovery(event), failure)
        }
        val status = answer.status.coerceIn(0, 65535).toUShort()
        val event = sessionRefreshEvent(status)
            ?: return try {
                store(answer.json())
                RefreshOutcome.Refreshed
            } catch (failure: TranRequestFailure) {
                RefreshOutcome.Failed(sessionRecovery(TranSessionEvent.RefreshFailed), failure)
            }
        return RefreshOutcome.Failed(sessionRecovery(event), answer.failure ?: expired(traceId = tid))
    }

    /** Applies a Rust action that ends the call: `SIGN_OUT` forgets the session; `KEEP` keeps it. */
    private fun act(action: TranSessionAction, failure: TranRequestFailure): TranRequestFailure = when (action) {
        TranSessionAction.SIGN_OUT -> {
            endLocally()
            expired()
        }
        TranSessionAction.KEEP, TranSessionAction.REFRESH -> failure
    }

    /** Stores a sign-in or refresh answer: the vault gets the refresh token, memory the access token. */
    private fun store(json: JSONObject): SessionUser {
        val token = decodeToken(json)
        vault.write(StoredSession(token.user.userId, token.user.role, token.refreshToken))
        accessToken = token.accessToken
        return token.user
    }

    private fun logged(failure: TranRequestFailure): TranRequestFailure {
        log(failure.spec.logLevel, TranFeedback.logLine(failure))
        return failure
    }

    private fun expired(traceId: String? = null) = TranRequestFailure(TranErrorCode.AUTH_SESSION_EXPIRED, status = UNAUTHORIZED, traceId = traceId)

    private fun url(path: String) = baseUrl.trimEnd('/') + path

    private fun devicePath(installationId: String) = "$DEVICES_PATH/$installationId"

    private fun post(path: String, body: JSONObject): Request =
        Request.Builder().url(url(path)).post(body.toString().toRequestBody(JSON)).build()

    /** One HTTP exchange; a non-2xx answer is returned classified, no answer at all is thrown. */
    private suspend fun send(request: Request): Answer = withContext(io) {
        val tp = request.header("traceparent") ?: TranRetry.newChildTraceparent(TranRetry.newTraceId())
        val traceId = parseTraceparentOffline(tp)?.traceId
        val withAccept = request.newBuilder()
            .header("Accept", "application/json")
            .header("traceparent", tp)
            .build()
        val response = try {
            http.newCall(withAccept).execute()
        } catch (error: IOException) {
            throw TranRequestFailure.classify(error, traceId = traceId)
        }
        response.use {
            if (it.isSuccessful) {
                Answer(it.code, it.body.string(), null)
            } else {
                Answer(it.code, "", TranRequestFailure.rejected(it, traceId = traceId))
            }
        }
    }

    private class Answer(val status: Int, val body: String, val failure: TranRequestFailure?) {
        fun json(): JSONObject = try {
            JSONObject(body)
        } catch (_: JSONException) {
            throw TranRequestFailure(TranErrorCode.CLIENT_UNEXPECTED, status = status)
        }
    }

    private sealed interface RefreshOutcome {
        data object Refreshed : RefreshOutcome
        data class Failed(val action: TranSessionAction, val failure: TranRequestFailure) : RefreshOutcome
    }

    companion object {
        /**
         * A client with no stored session, on [api]'s server and transport: what a device session
         * without an API session (the screen contract's preset, a sign-in that never reached the
         * API) uses to delete the account. It holds no credential, so the server's answer decides:
         * `401` ends the session, no answer keeps it. The app passes its vault-backed client instead.
         */
        fun deviceOnly(api: TranApiClient): SessionClient =
            SessionClient(InMemorySessionVault(), baseUrl = api.baseUrl, http = api.transport, io = api.io, standing = api.standing)

        private const val SESSION_PATH = ApiContract.basePath + "/auth/session"
        private const val REFRESH_PATH = ApiContract.basePath + "/auth/refresh"
        private const val SIGN_OUT_PATH = ApiContract.basePath + "/auth/sign-out"
        private const val ACCOUNT_PATH = ApiContract.basePath + "/account"
        private const val DEVICES_PATH = ApiContract.basePath + "/devices"

        /**
         * A sign-in or refresh answer, read tolerantly (REQ-VER-008): fields it does not know are
         * ignored; `access_token`, `refresh_token` and `user` must be there with their types, or the
         * answer is a contract break (`client.unexpected`), never a sign-out.
         */
        internal fun decodeToken(json: JSONObject): SessionToken {
            val user = json.opt("user") as? JSONObject ?: throw unexpected()
            return SessionToken(
                user = decodeUser(user),
                accessToken = json.string("access_token"),
                refreshToken = json.string("refresh_token"),
            )
        }

        /**
         * `{ "user_id", "role" }` and anything else, ignored. A role this build does not know reads
         * as the catalogue's fallback (REQ-VER-008); a missing one is a contract break.
         */
        internal fun decodeUser(json: JSONObject): SessionUser =
            SessionUser(userId = json.string("user_id"), role = tranUserRoleFromApi(json.string("role", allowEmpty = true)))

        private fun JSONObject.string(key: String, allowEmpty: Boolean = false): String =
            (opt(key) as? String)?.takeIf { allowEmpty || it.isNotEmpty() } ?: throw unexpected()

        private fun unexpected() = TranRequestFailure(TranErrorCode.CLIENT_UNEXPECTED)

        private const val UNAUTHORIZED = 401
        private val JSON = "application/json".toMediaType()
    }
}
