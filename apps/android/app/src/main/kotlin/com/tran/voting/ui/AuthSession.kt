package com.tran.voting.ui

import uniffi.tran_uniffi.TranAppDestination
import uniffi.tran_uniffi.TranUserRole
import uniffi.tran_uniffi.resolveDestinationOffline

/**
 * Session state the app stores. Where a session leads is decided by `rust-core` through UniFFI
 * (`resolveDestinationOffline`, pinned by `fixtures/navigation.json`) — never re-implemented here.
 */
sealed interface AuthSession {
    /** The signed-in role, or `null` after sign-out. */
    val role: TranUserRole?

    data object Unauthenticated : AuthSession {
        override val role: TranUserRole? = null
    }

    data class Authenticated(val userId: String, override val role: TranUserRole) : AuthSession
}

/** The screen this session leads to, resolved by the shared Rust navigation director. */
val AuthSession.destination: TranAppDestination
    get() = resolveDestinationOffline(role)
