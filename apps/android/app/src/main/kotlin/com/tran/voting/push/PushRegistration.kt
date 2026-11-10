// Verifies: REQ-PSH-009 REQ-PSH-010 REQ-PSH-011
package com.tran.voting.push

import com.tran.voting.BuildConfig
import com.tran.voting.api.TranRequestFailure
import com.tran.voting.permissions.PermissionGateway
import com.tran.voting.session.EndedSession
import com.tran.voting.session.SessionClient
import com.tran.voting.ui.feedback.TranFeedback
import com.tran.voting.ui.feedback.tranLogcat
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import uniffi.tran_uniffi.TranLastRegistration
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.TranPermissionStep
import uniffi.tran_uniffi.TranPushAction
import uniffi.tran_uniffi.TranPushState
import uniffi.tran_uniffi.permissionStep
import uniffi.tran_uniffi.pushSync
import java.util.Locale

/** Why a sync runs (REQ-PSH-009); only ever logged. */
enum class PushTrigger { LAUNCH, FOREGROUND, NEW_TOKEN, SIGN_IN, PERMISSION_GRANTED }

/**
 * Keeps this installation's registration on the API right (spec 027). What to do is always Rust's
 * `pushSync`; this gathers the state, carries out the answer and records it.
 *
 * - `REGISTER`: `PUT /api/devices/{installation_id}`, then the token and the time are recorded;
 * - `UNREGISTER`: the record is cleared first, then a best-effort `DELETE` when a session is left;
 * - a failure is logged once with the catalogue's fields, kept from the person (a background sync
 *   is not theirs to hear about), and the next trigger tries again.
 *
 * No log line carries the token or the installation id (REQ-PSH-007's rule, on the device). The
 * token is fetched only when push is available, notifications are granted and there is a session.
 */
class PushRegistration(
    private val gateway: PushGateway,
    private val permissions: PermissionGateway,
    /** The API session; `null` for a device-only session, which never registers. */
    private val sessions: SessionClient?,
    private val store: PushStore,
    /** The app's language now, sent as a tag (`ne-NP`). */
    private val locale: () -> Locale = { Locale.getDefault() },
    private val appVersion: String = BuildConfig.VERSION_NAME,
    /** Unix seconds on the device clock. */
    private val now: () -> Long = { System.currentTimeMillis() / 1000 },
    private val log: (TranLogLevel, String) -> Unit = ::tranLogcat,
) {
    private val mutex = Mutex()

    /** Runs the sync once; concurrent triggers take turns. Returns what Rust decided. */
    suspend fun sync(trigger: PushTrigger): TranPushAction = mutex.withLock {
        val available = gateway.available
        val granted = permissionStep(permissions.status(TranPermissionId.NOTIFICATIONS), false) ==
            TranPermissionStep.USE_FEATURE
        val client = sessions?.takeIf { it.hasSession }
        val token = if (available && granted && client != null) gateway.token() else null
        val action = pushSync(
            TranPushState(
                pushAvailable = available,
                permissionGranted = granted,
                hasSession = client != null,
                currentToken = token,
                lastRegistration = store.lastRegistration,
                nowUnixS = now(),
            ),
        )
        log(TranLogLevel.DEBUG, "push sync trigger=${trigger.wire} action=${action.name.lowercase(Locale.ROOT)}")
        when (action) {
            TranPushAction.REGISTER -> register(client!!, token!!)
            TranPushAction.UNREGISTER -> {
                store.lastRegistration = null
                if (client != null) attempt("unregister") { client.unregisterDevice(store.installationId) }
            }
            TranPushAction.NOTHING -> Unit
        }
        action
    }

    /**
     * Sign-out, part one (REQ-PSH-011): forget the recorded registration at once, before the session
     * ends. Returns whether there was one, for [unregisterAfterSignOut].
     */
    fun forget(): Boolean {
        val recorded = store.lastRegistration != null
        store.lastRegistration = null
        return recorded
    }

    /**
     * Sign-out, part two: the best-effort `DELETE` with the session's last access token, before the
     * caller revokes it. A failure changes nothing: revoking the session removes it on the server.
     */
    suspend fun unregisterAfterSignOut(ended: EndedSession) {
        val client = sessions ?: return
        attempt("unregister") { client.unregisterDevice(store.installationId, ended) }
    }

    private suspend fun register(client: SessionClient, token: String) {
        val body = JSONObject()
            .put("platform", "android")
            .put("push_token", token)
            // FCM has one environment (docs/API.md).
            .put("environment", "production")
            .put("locale", pushLocaleTag(locale()))
            .put("app_version", appVersion)
            .put("marketing", false)
        val registered = attempt("register") { client.registerDevice(store.installationId, body) }
        if (registered) store.lastRegistration = TranLastRegistration(token = token, registeredAtUnixS = now())
    }

    /** Runs a call; a failure is logged once, by its catalogue fields only. */
    private suspend fun attempt(what: String, call: suspend () -> Unit): Boolean = try {
        call()
        true
    } catch (failure: TranRequestFailure) {
        log(failure.spec.logLevel, "push $what ${TranFeedback.logLine(failure)}")
        false
    }

    private val PushTrigger.wire: String get() = name.lowercase(Locale.ROOT)
}

/**
 * The app's language as the tag the API accepts (`en`, `ne-NP`, `zh-Hant-TW`): language, script and
 * region only. Android adds extensions for regional preferences (`en-US-u-mu-celsius`), which are
 * not the language and would fail the API's check.
 */
fun pushLocaleTag(locale: Locale): String = try {
    Locale.Builder().setLanguage(locale.language).setScript(locale.script).setRegion(locale.country).build()
        .toLanguageTag()
} catch (malformed: java.util.IllformedLocaleException) {
    // A legacy variant Locale.Builder refuses: the language alone is still right.
    Locale.Builder().setLanguage(locale.language).build().toLanguageTag()
}
