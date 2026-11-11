// Verifies: REQ-DB-011 REQ-DB-012
package com.tran.voting.storage

import java.math.BigInteger
import uniffi.tran_uniffi.TranStoredRecordAction
import uniffi.tran_uniffi.tranStoredRecordDecision

/**
 * How every record this app keeps on the device is read (spec 030): the `schema` rule here, then
 * the Rust decision `tranStoredRecordDecision`. The same rule as `stored_schema` in
 * `crates/rust-core`, pinned by `fixtures/stored-records.json`.
 */
object StoredSchema {
    /** The version of a record written before records carried `schema` (the first release). */
    val LEGACY: UInt = 1u

    /** What reading a stored record comes to. */
    enum class Verdict {
        /** Use it: the current version, or an older one read into the current shape. Nothing is written back. */
        USE,

        /** A version newer than this build: treat as absent and leave it for the app that wrote it. */
        NEWER,

        /** Unreadable: delete it and treat as absent. */
        UNREADABLE,
    }

    /**
     * The version a present `schema` value names, or `null` when the record is unreadable: it must
     * be a whole number from 1 to `UInt.MAX_VALUE`. A string, a boolean, a fractional, negative or
     * larger number, 0 or JSON `null` is unreadable. Never coerces, never throws.
     */
    fun version(value: Any?): UInt? {
        val whole = when (value) {
            is Int -> value.toLong()
            is Long -> value
            is Short -> value.toLong()
            is Byte -> value.toLong()
            is BigInteger -> if (value.bitLength() < Long.SIZE_BITS) value.toLong() else null
            else -> null
        } ?: return null
        return if (whole in 1L..UInt.MAX_VALUE.toLong()) whole.toUInt() else null
    }

    /** The verdict for a record whose `schema` is [value], or absent when [present] is false. */
    fun verdict(present: Boolean, value: Any?, current: UInt): Verdict {
        val version = if (present) version(value) ?: return Verdict.UNREADABLE else LEGACY
        return when (tranStoredRecordDecision(version, current)) {
            TranStoredRecordAction.USE, TranStoredRecordAction.UPGRADE -> Verdict.USE
            TranStoredRecordAction.DISCARD -> Verdict.NEWER
        }
    }
}
