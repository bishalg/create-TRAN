// Verifies: REQ-PSH-009
package com.tran.voting.parity

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranLastRegistration
import uniffi.tran_uniffi.TranPushAction
import uniffi.tran_uniffi.TranPushState
import uniffi.tran_uniffi.devicePolicy
import uniffi.tran_uniffi.pushSync
import java.io.File
import java.util.Locale

/** `fixtures/push.json` through the UniFFI surface the app uses (spec 027). */
class PushParityTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private val fixture: JSONObject by lazy {
            val repoRoot = System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set (Gradle test task should provide it)")
            JSONObject(File(repoRoot, "fixtures/push.json").readText())
        }

        private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)
    }

    @Test
    fun `REQ-PSH-009 the device policy matches the fixture`() {
        val policy = fixture.getJSONObject("policy")
        assertEquals(policy.getInt("staleAfterDays").toUInt(), devicePolicy().staleAfterDays)
        assertEquals(policy.getInt("refreshAfterDays").toUInt(), devicePolicy().refreshAfterDays)
    }

    @Test
    fun `REQ-PSH-009 every sync row matches the fixture`() {
        val rows = fixture.getJSONArray("sync").objects()
        assertEquals("the fixture has rows", true, rows.size > 10)
        val seen = mutableSetOf<TranPushAction>()
        for (row in rows) {
            val last = row.optJSONObject("lastRegistration")?.let {
                TranLastRegistration(token = it.getString("token"), registeredAtUnixS = it.getLong("registeredAtUnixS"))
            }
            val state = TranPushState(
                pushAvailable = row.getBoolean("pushAvailable"),
                permissionGranted = row.getBoolean("permissionGranted"),
                hasSession = row.getBoolean("hasSession"),
                currentToken = if (row.isNull("currentToken")) null else row.getString("currentToken"),
                lastRegistration = last,
                nowUnixS = row.getLong("nowUnixS"),
            )
            val action = pushSync(state)
            seen += action
            assertEquals(row.getString("name"), row.getString("action"), action.name.lowercase(Locale.ROOT))
        }
        assertEquals("every action is pinned", TranPushAction.entries.toSet(), seen)
    }
}
