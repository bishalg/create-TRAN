// Verifies: REQ-DB-011 REQ-DB-012
package com.tran.voting.session

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import com.tran.voting.api.MemoryConfigPreferences
import com.tran.voting.api.RemoteConfigStore
import com.tran.voting.generated.Flags
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.push.PushPreferences
import com.tran.voting.storage.StoredSchema
import java.io.File
import java.math.BigInteger
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uniffi.tran_uniffi.TranStoredRecordAction
import uniffi.tran_uniffi.TranUserRole
import uniffi.tran_uniffi.tranStoredConfigSchema
import uniffi.tran_uniffi.tranStoredPushSchema
import uniffi.tran_uniffi.tranStoredRecordDecision
import uniffi.tran_uniffi.tranStoredSessionSchema

/**
 * `fixtures/stored-records.json` through the stores the app really reads: every kept record is
 * written as the stored item (the vault's ciphertext, the push preferences, the config cache) and
 * read back by [KeystoreSessionVault], [PushPreferences] and `RemoteConfigStore`. Each case says
 * what the store hands back and whether the stored record is still there afterwards.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class StoredRecordTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private val fixture: JSONObject by lazy {
            val repoRoot = System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set (Gradle test task should provide it)")
            JSONObject(File(repoRoot, "fixtures/stored-records.json").readText())
        }

        private const val VAULT = "tran_session_vault_stored_records_test"
    }

    private class RecordCase(val name: String, val raw: JSONObject, val expected: JSONObject?, val kept: Boolean)

    private fun cases(kind: String): List<RecordCase> {
        val rows = fixture.getJSONObject("records").getJSONArray(kind)
        assertTrue(kind, rows.length() > 0)
        return (0 until rows.length()).map { i ->
            val row = rows.getJSONObject(i)
            RecordCase(row.getString("name"), row.getJSONObject("raw"), row.optJSONObject("expected"), row.getBoolean("kept"))
        }
    }

    private val context: Context get() = RuntimeEnvironment.getApplication()

    private fun preferences(name: String): SharedPreferences =
        context.getSharedPreferences(name, Context.MODE_PRIVATE).also { it.edit().clear().commit() }

    @Before
    fun reset() {
        preferences(PushPreferences.PREFERENCES)
        preferences(VAULT)
    }

    // Decisions

    @Test
    fun currentSchemasMatchFixture() {
        val current = fixture.getJSONObject("currentSchemas")
        assertEquals(current.getInt("session"), tranStoredSessionSchema().toInt())
        assertEquals(current.getInt("push"), tranStoredPushSchema().toInt())
        assertEquals(current.getInt("config"), tranStoredConfigSchema().toInt())
    }

    @Test
    fun storedRecordDecisionsMatchFixture() {
        val cases = fixture.getJSONArray("decisions")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val action = when (tranStoredRecordDecision(c.getLong("schema").toUInt(), c.getLong("current").toUInt())) {
                TranStoredRecordAction.USE -> "use"
                TranStoredRecordAction.UPGRADE -> "upgrade"
                TranStoredRecordAction.DISCARD -> "discard"
            }
            assertEquals(c.getString("name"), c.getString("action"), action)
        }
    }

    @Test
    fun theSchemaRuleNeverCoercesOrThrows() {
        assertEquals(2u, StoredSchema.version(2))
        assertEquals(UInt.MAX_VALUE, StoredSchema.version(UInt.MAX_VALUE.toLong()))
        val bad = listOf<Any?>(
            "2", -1, 1.5, 2.0, 0, 4_294_967_298L, Long.MIN_VALUE, BigInteger("18446744073709551616"),
            true, null, JSONObject.NULL,
        )
        for (value in bad) assertNull("$value", StoredSchema.version(value))
        assertEquals(StoredSchema.Verdict.USE, StoredSchema.verdict(present = false, value = null, current = 2u))
        assertEquals(StoredSchema.Verdict.UNREADABLE, StoredSchema.verdict(present = true, value = null, current = 2u))
        assertEquals(StoredSchema.Verdict.NEWER, StoredSchema.verdict(present = true, value = 3, current = 2u))
    }

    // Push, through the real preferences

    /** Push has no JSON on the device: each fixture key is one preference, of the type its value has. */
    private val pushKeys = mapOf("schema" to "schema", "token" to "registered_token", "registered_at_unix_s" to "registered_at_unix_s")

    private fun SharedPreferences.Editor.putJson(key: String, value: Any?): SharedPreferences.Editor = when (value) {
        is String -> putString(key, value)
        is Boolean -> putBoolean(key, value)
        // The app writes the registration time as a Long, and any whole number beyond an Int is one.
        is Int -> if (key == "registered_at_unix_s") putLong(key, value.toLong()) else putInt(key, value)
        is Long -> putLong(key, value)
        is Number -> putFloat(key, value.toFloat())
        else -> error("$key: no preference type for $value")
    }

    @Test
    fun everyKeptPushRecordReadsThroughThePushStore() {
        for (c in cases("push")) {
            val preferences = preferences(PushPreferences.PREFERENCES)
            val editor = preferences.edit()
            for (field in c.raw.keys()) editor.putJson(pushKeys.getValue(field), c.raw.get(field))
            editor.commit()
            val before = pushKeys.values.associateWith { preferences.all[it] }

            val registration = PushPreferences(preferences).lastRegistration

            if (c.expected == null) {
                assertNull(c.name, registration)
            } else {
                assertEquals(c.name, c.expected.getString("token"), registration?.token)
                assertEquals(c.name, c.expected.getLong("registeredAtUnixS"), registration?.registeredAtUnixS)
            }
            val after = pushKeys.values.associateWith { preferences.all[it] }
            assertEquals("${c.name}: stored afterwards", if (c.kept) before else pushKeys.values.associateWith { null }, after)
        }
    }

    /** What the release before versioning wrote: a token and a Long time, no schema key. */
    @Test
    fun thePreviousReleaseRegistrationIsKept() {
        val preferences = preferences(PushPreferences.PREFERENCES)
        preferences.edit().putString("registered_token", "tok-legacy").putLong("registered_at_unix_s", 1_700_000_000L).commit()

        val read = PushPreferences(preferences).lastRegistration

        assertEquals("tok-legacy", read?.token)
        assertEquals(1_700_000_000L, read?.registeredAtUnixS)
        assertTrue("reading writes nothing", !preferences.contains("schema"))
    }

    // Session, through the real vault

    /**
     * The JVM has no Android Keystore, so the vault's cipher seam gets AES-256-GCM under a software
     * key; the Keystore cipher itself is tested on a device (`KeystoreSessionVaultTest`, instrumented).
     * Everything else is the vault the app runs: preferences, Base64, decoding, what it deletes.
     */
    private class SoftwareCipher : VaultCipher {
        private val key: SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

        override fun seal(plain: ByteArray): Pair<ByteArray, ByteArray> {
            val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv)) }
            return cipher.doFinal(plain) to iv
        }

        override fun open(ciphertext: ByteArray, iv: ByteArray): ByteArray =
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv)) }
                .doFinal(ciphertext)
    }

    private val cipher = SoftwareCipher()

    private fun vault() = KeystoreSessionVault(context, VAULT, cipher)

    private fun vaultPreferences() = context.getSharedPreferences(VAULT, Context.MODE_PRIVATE)

    /** Stores [plain] as the vault's ciphertext, the way an earlier release left it. */
    private fun storeRecord(plain: ByteArray) {
        val (sealed, iv) = cipher.seal(plain)
        vaultPreferences().edit()
            .putString(KeystoreSessionVault.KEY_CIPHERTEXT, Base64.encodeToString(sealed, Base64.NO_WRAP))
            .putString(KeystoreSessionVault.KEY_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
            .commit()
    }

    @Test
    fun everyKeptSessionRecordReadsThroughTheVault() {
        for (c in cases("session")) {
            storeRecord(c.raw.toString().toByteArray(Charsets.UTF_8))
            val before = vaultPreferences().all.toMap()

            val read = vault().read()

            if (c.expected == null) {
                assertNull(c.name, read)
            } else {
                assertEquals(c.name, c.expected.getInt("schema"), read?.schema)
                assertEquals(c.name, c.expected.getString("userId"), read?.userId)
                assertEquals(c.name, c.expected.getString("role"), read?.role?.wire)
                assertEquals(c.name, c.expected.getString("refreshToken"), read?.refreshToken)
            }
            // Reading never rewrites: the same ciphertext, or nothing when unreadable.
            assertEquals("${c.name}: stored afterwards", if (c.kept) before else emptyMap<String, Any?>(), vaultPreferences().all)
        }
    }

    /** The exact record the release before versioning encrypted (`encodeRecord` without `schema`). */
    @Test
    fun thePreviousReleaseSessionKeepsThePersonSignedIn() {
        val legacy = JSONObject().put("user_id", "voter-001").put("role", "citizen_voter").put("refresh_token", "rt-legacy")
        storeRecord(legacy.toString().toByteArray(Charsets.UTF_8))
        val before = vaultPreferences().all.toMap()

        assertEquals(StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, "rt-legacy"), vault().read())
        // The upgrade writes nothing, so no failed rewrite can sign the person out (REQ-DB-012).
        assertEquals(before, vaultPreferences().all)
        // The next rotation stores the current version.
        vault().write(StoredSession("voter-001", TranUserRole.CITIZEN_VOTER, "rt-next"))
        val sealed = Base64.decode(vaultPreferences().getString(KeystoreSessionVault.KEY_CIPHERTEXT, null), Base64.NO_WRAP)
        val iv = Base64.decode(vaultPreferences().getString(KeystoreSessionVault.KEY_IV, null), Base64.NO_WRAP)
        val stored = JSONObject(String(cipher.open(sealed, iv), Charsets.UTF_8))
        assertEquals(tranStoredSessionSchema().toInt(), stored.getInt("schema"))
        assertEquals("rt-next", vault().read()?.refreshToken)
    }

    @Test
    fun corruptSessionBytesAreDeleted() {
        for (plain in listOf("not json".toByteArray(), byteArrayOf(0xFF.toByte(), 0, 0x7B), "[]".toByteArray(), ByteArray(0))) {
            storeRecord(plain)
            assertNull(vault().read())
            assertTrue("unreadable must not linger (REQ-SEC-020)", vaultPreferences().all.isEmpty())
        }
        // Ciphertext that is not this key's: unreadable too.
        vaultPreferences().edit().putString(KeystoreSessionVault.KEY_CIPHERTEXT, "AAAA").putString(KeystoreSessionVault.KEY_IV, "AAAAAAAAAAAAAAAA").commit()
        assertNull(vault().read())
        assertTrue(vaultPreferences().all.isEmpty())
    }

    // Config, through the real store

    private val configKey = "tran.remote_config"
    private val etagKey = "tran.remote_config_etag"

    @Test
    fun everyKeptConfigRecordReadsThroughTheConfigStore() {
        for (c in cases("config")) {
            val preferences = MemoryConfigPreferences()
            val raw = c.raw.toString()
            preferences.setString(configKey, raw)
            preferences.setString(etagKey, "\"etag-1\"")

            val store = RemoteConfigStore(preferences)

            if (c.expected == null) {
                assertEquals("${c.name}: compiled default", Flags.NOTIFY_ME_DEFAULT, store.isNotifyMe)
                assertEquals(c.name, 1, store.version)
                assertNull("${c.name}: no ETag for a cache not in use", preferences.getString(etagKey))
            } else {
                assertEquals(c.name, c.expected.getJSONObject("flags").getBoolean("notify_me"), store.isNotifyMe)
                assertEquals(c.name, c.expected.getInt("configVersion"), store.version)
                val client = c.expected.optJSONObject("client")
                assertEquals(c.name, client?.getString("minimumVersion"), store.minimumVersion)
                assertEquals(c.name, client?.getString("recommendedVersion"), store.recommendedVersion)
                assertEquals("${c.name}: a used cache keeps its ETag", "\"etag-1\"", preferences.getString(etagKey))
            }
            assertEquals("${c.name}: stored afterwards", if (c.kept) raw else null, preferences.getString(configKey))
        }
    }

    @Test
    fun corruptConfigBytesAreDeleted() {
        val preferences = MemoryConfigPreferences()
        preferences.setString(configKey, "not json")
        preferences.setString(etagKey, "\"etag-1\"")

        val store = RemoteConfigStore(preferences)

        assertEquals(Flags.NOTIFY_ME_DEFAULT, store.isNotifyMe)
        assertNull(preferences.getString(configKey))
        assertNull(preferences.getString(etagKey))
    }
}
