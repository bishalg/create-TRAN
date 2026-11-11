// Verifies: REQ-DB-011 REQ-DB-012
package com.tran.voting.session

import com.tran.voting.api.MemoryConfigPreferences
import com.tran.voting.api.RemoteConfigStore
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.push.PushPreferences
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranStoredRecordAction
import uniffi.tran_uniffi.tranReadStoredPush
import uniffi.tran_uniffi.tranReadStoredSession
import uniffi.tran_uniffi.tranStoredConfigSchema
import uniffi.tran_uniffi.tranStoredPushSchema
import uniffi.tran_uniffi.tranStoredRecordDecision
import uniffi.tran_uniffi.tranStoredSessionSchema
import java.io.File

class StoredRecordTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private val fixture: JSONObject by lazy {
            val repoRoot =
                System.getenv("REPO_ROOT")
                    ?: error("REPO_ROOT not set (Gradle test task should provide it)")
            JSONObject(File(repoRoot, "fixtures/stored-records.json").readText())
        }
    }

    @Test
    fun testCurrentSchemasMatchFixture() {
        val currentSchemas = fixture.getJSONObject("currentSchemas")
        assertEquals(currentSchemas.getInt("session"), tranStoredSessionSchema().toInt())
        assertEquals(currentSchemas.getInt("push"), tranStoredPushSchema().toInt())
        assertEquals(currentSchemas.getInt("config"), tranStoredConfigSchema().toInt())
    }

    @Test
    fun testStoredRecordDecisionsMatchFixture() {
        val cases = fixture.getJSONArray("decisions")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val schema = c.getInt("schema")
            val current = c.getInt("current")
            val expectedAction = c.getString("action")

            val decision = tranStoredRecordDecision(schema.toUInt(), current.toUInt())
            val actionStr = when (decision) {
                TranStoredRecordAction.USE -> "use"
                TranStoredRecordAction.UPGRADE -> "upgrade"
                TranStoredRecordAction.DISCARD -> "discard"
            }
            assertEquals(name, expectedAction, actionStr)
        }
    }

    @Test
    fun testSessionRecordsKeptVersionsKeepUserSignedIn() {
        val records = fixture.getJSONObject("records")
        val sessionCases = records.getJSONArray("session")

        for (i in 0 until sessionCases.length()) {
            val c = sessionCases.getJSONObject(i)
            val name = c.getString("name")
            val raw = c.getJSONObject("raw").toString()
            val result = tranReadStoredSession(raw, tranStoredSessionSchema())

            if (c.isNull("expected")) {
                assertNull("$name: should be null / discarded", result)
            } else {
                val expected = c.getJSONObject("expected")
                assertNotNull("$name: should be non-null", result)
                assertEquals("$name: schema", expected.getInt("schema"), result!!.schema.toInt())
                assertEquals("$name: userId", expected.getString("userId"), result.userId)
                assertEquals("$name: role", expected.getString("role"), result.role)
                assertEquals("$name: refreshToken", expected.getString("refreshToken"), result.refreshToken)
            }
        }
    }

    @Test
    fun testPushRecordsKeptVersionsMatchFixture() {
        val records = fixture.getJSONObject("records")
        val pushCases = records.getJSONArray("push")

        for (i in 0 until pushCases.length()) {
            val c = pushCases.getJSONObject(i)
            val name = c.getString("name")
            val raw = c.getJSONObject("raw").toString()
            val result = tranReadStoredPush(raw, tranStoredPushSchema())

            if (c.isNull("expected")) {
                assertNull("$name: should be null / discarded", result)
            } else {
                val expected = c.getJSONObject("expected")
                assertNotNull("$name: should be non-null", result)
                assertEquals("$name: schema", expected.getInt("schema"), result!!.schema.toInt())
                assertEquals("$name: token", expected.getString("token"), result.token)
                assertEquals("$name: registeredAtUnixS", expected.getLong("registeredAtUnixS"), result.registeredAtUnixS)
            }
        }
    }

    @Test
    fun testRemoteConfigStoreUpgradesAndDiscards() {
        val prefs = MemoryConfigPreferences()

        // v1 record
        val v1Json = JSONObject()
            .put("schema", 1)
            .put("flags", JSONObject().put("notify_me", true))
            .put("client", JSONObject().put("minimum_version", "1.0.0").put("recommended_version", "1.2.0"))
            .put("config_version", 10)
        prefs.setString("tran.remote_config", v1Json.toString())

        val store = RemoteConfigStore(prefs)
        assertEquals(true, store.isNotifyMe)
        assertEquals(10, store.version)

        // future schema 99
        val vFutureJson = JSONObject()
            .put("schema", 99)
            .put("flags", JSONObject().put("notify_me", true))
            .put("config_version", 99)
        prefs.setString("tran.remote_config", vFutureJson.toString())

        val storeFuture = RemoteConfigStore(prefs)
        assertEquals(false, storeFuture.isNotifyMe)
        assertEquals(1, storeFuture.version)
    }
}
