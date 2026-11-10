// Verifies: REQ-SEC-005 REQ-SEC-015
package com.tran.voting.parity

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranSessionAction
import uniffi.tran_uniffi.TranSessionEvent
import uniffi.tran_uniffi.sessionPolicy
import uniffi.tran_uniffi.sessionRecovery
import uniffi.tran_uniffi.sessionRefreshEvent

/** `fixtures/session.json` through the UniFFI surface the session client calls. */
class SessionParityTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private val fixture: JSONObject by lazy {
            val repoRoot = System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set (Gradle test task should provide it)")
            JSONObject(File(repoRoot, "fixtures/session.json").readText())
        }
    }

    private fun event(row: JSONObject): TranSessionEvent = when (val raw = row.getString("event")) {
        "unauthorized" -> TranSessionEvent.Unauthorized(
            hasRefreshCredential = row.getBoolean("hasRefreshCredential"),
            alreadyRetried = row.getBoolean("alreadyRetried"),
        )
        "refresh_rejected" -> TranSessionEvent.RefreshRejected
        "refresh_failed" -> TranSessionEvent.RefreshFailed
        else -> error("unknown fixture event $raw")
    }

    private fun TranSessionAction.code(): String = when (this) {
        TranSessionAction.REFRESH -> "refresh"
        TranSessionAction.SIGN_OUT -> "sign_out"
        TranSessionAction.KEEP -> "keep"
    }

    private fun TranSessionEvent?.code(): String? = when (this) {
        null -> null
        is TranSessionEvent.Unauthorized -> "unauthorized"
        TranSessionEvent.RefreshRejected -> "refresh_rejected"
        TranSessionEvent.RefreshFailed -> "refresh_failed"
    }

    @Test
    fun policyMatchesGoldenFixture() {
        val expected = fixture.getJSONObject("policy")
        val policy = sessionPolicy()
        assertEquals(expected.getLong("accessTtlSeconds"), policy.accessTtlSeconds.toLong())
        assertEquals(expected.getLong("refreshTtlSeconds"), policy.refreshTtlSeconds.toLong())
        assertEquals(expected.getInt("tokenBytes"), policy.tokenBytes.toInt())
    }

    @Test
    fun recoveryMatchesGoldenFixture() {
        val rows = fixture.getJSONArray("recovery")
        assertTrue("fixture has recovery rows", rows.length() > 0)
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            assertEquals(row.getString("name"), row.getString("action"), sessionRecovery(event(row)).code())
        }
    }

    @Test
    fun refreshResponsesMatchGoldenFixture() {
        val rows = fixture.getJSONArray("refreshResponses")
        assertTrue("fixture has refresh rows", rows.length() > 0)
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            val status = if (row.isNull("status")) null else row.getInt("status").toUShort()
            val expected = if (row.isNull("event")) null else row.getString("event")
            assertEquals(row.getString("name"), expected, sessionRefreshEvent(status).code())
        }
    }
}
