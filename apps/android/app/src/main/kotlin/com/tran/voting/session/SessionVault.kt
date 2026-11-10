// Verifies: REQ-SEC-017 REQ-SEC-020 REQ-VER-008
package com.tran.voting.session

import com.tran.voting.generated.ApiContract
import uniffi.tran_uniffi.TranUserRole

/**
 * The one record a device keeps for an API session (ADR-0039 decision 4): the refresh token, with
 * the user id and role it belongs to. The access token is never part of it (REQ-SEC-017).
 */
class StoredSession(val userId: String, val role: TranUserRole, val refreshToken: String) {
    override fun equals(other: Any?): Boolean =
        other is StoredSession && other.userId == userId && other.role == role && other.refreshToken == refreshToken

    override fun hashCode(): Int = (userId.hashCode() * 31 + role.hashCode()) * 31 + refreshToken.hashCode()

    /** A record printed by accident shows who, never the credential (REQ-SEC-014). */
    override fun toString(): String = "StoredSession(userId=$userId, role=${role.wire}, refreshToken=[redacted])"
}

/** The one place a platform persists the refresh token (spec 022 "vault"). */
interface SessionVault {
    /** The stored record, or `null` when there is none or it cannot be read (which also deletes it). */
    fun read(): StoredSession?

    /** Replaces the stored record. */
    fun write(session: StoredSession)

    /** Deletes the record; safe to repeat. */
    fun clear()
}

/** The double the JVM suites use, so they stay hermetic (ADR-0023); the real vault is tested on a device. */
class InMemorySessionVault(initial: StoredSession? = null) : SessionVault {
    @Volatile
    private var stored: StoredSession? = initial

    override fun read(): StoredSession? = stored

    override fun write(session: StoredSession) {
        stored = session
    }

    override fun clear() {
        stored = null
    }
}

/** The API's wire name for a role (`docs/API.md`). */
val TranUserRole.wire: String
    get() = when (this) {
        TranUserRole.CITIZEN_VOTER -> "citizen_voter"
        TranUserRole.ELECTION_AUDITOR -> "election_auditor"
    }

/** The role a wire name stands for, or `null` for anything else. */
fun tranUserRoleFromWire(raw: String): TranUserRole? = TranUserRole.entries.firstOrNull { it.wire == raw }

/**
 * The role in an API answer, read tolerantly (REQ-VER-008): a value this build does not know is the
 * generated fallback (`citizen_voter`), so a newer server's role never breaks an older app.
 */
fun tranUserRoleFromApi(raw: String): TranUserRole {
    val known = ApiContract.WireEnums.UserRole.values
    val decoded = if (raw in known) raw else ApiContract.WireEnums.UserRole.fallback
    return checkNotNull(tranUserRoleFromWire(decoded)) { "the generated user_role values match TranUserRole" }
}
