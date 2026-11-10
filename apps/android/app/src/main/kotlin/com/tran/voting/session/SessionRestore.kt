// Verifies: REQ-SEC-021
package com.tran.voting.session

import com.tran.voting.api.TranRequestFailure
import com.tran.voting.ui.AuthSession
import uniffi.tran_uniffi.TranErrorCode

/** What the background check of a restored session decided (REQ-SEC-021). */
enum class RestoreOutcome {
    /** The API knows the session. */
    VALID,

    /** Rust said `SIGN_OUT`: the vault is already cleared; present `auth.session_expired`. */
    SIGNED_OUT,

    /** No usable answer (offline, timeout, `5xx`): keep the device session and the vault. */
    KEPT,
}

/**
 * The session to open with, read from the vault on the calling thread with no network: where it
 * leads is then `AuthSession.destination` (`resolveDestinationOffline`).
 */
fun restoredSession(vault: SessionVault): AuthSession =
    vault.read()?.let { AuthSession.Authenticated(userId = it.userId, role = it.role) } ?: AuthSession.Unauthenticated

/**
 * Validates the restored session against `GET /api/auth/session`, refreshing first when needed. The
 * client already acted on Rust's `sessionRecovery`; this only names the result for the UI. An
 * unreachable API never signs the user out.
 */
suspend fun validateRestoredSession(client: SessionClient): RestoreOutcome = try {
    client.currentUser()
    RestoreOutcome.VALID
} catch (failure: TranRequestFailure) {
    if (failure.code == TranErrorCode.AUTH_SESSION_EXPIRED) RestoreOutcome.SIGNED_OUT else RestoreOutcome.KEPT
}
