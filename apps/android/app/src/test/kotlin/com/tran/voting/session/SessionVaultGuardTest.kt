// Verifies: REQ-SEC-017 REQ-SEC-020 REQ-PRV-006 REQ-PSH-010
package com.tran.voting.session

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A source guard: the session reaches storage only through the Keystore vault, as ciphertext. A
 * token or session written to plain preferences, a file or `BuildConfig` fails this test.
 */
class SessionVaultGuardTest {
    private val repoRoot = File(System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set (Gradle test task should provide it)"))
    private val app = File(repoRoot, "apps/android/app")
    private val vaultFile = "src/main/kotlin/com/tran/voting/session/KeystoreSessionVault.kt"

    /**
     * The one other writer: the permission gateway remembers whether it has asked (spec 026), which
     * Android needs to tell "never asked" from "refused for good". Not a credential, so plain
     * preferences; [thePermissionGatewayStoresOnlyWhetherItAsked] keeps it to that.
     */
    private val gatewayFile = "src/main/kotlin/com/tran/voting/permissions/SystemPermissionGateway.kt"

    /**
     * The push preferences (spec 027): the installation id, a random UUID that only names this
     * install, and the last registration's token and time, which the weekly refresh needs. A push
     * token addresses a device and is not a credential (spec 027), so plain preferences, not the
     * vault; [thePushPreferencesStoreOnlyTheInstallationAndItsRegistration] keeps it to that.
     */
    private val pushFile = "src/main/kotlin/com/tran/voting/push/PushPreferences.kt"

    /** Hand-written main sources (generated bindings and tokens are exempt). */
    private val sources: Map<String, String> =
        listOf("src/main/kotlin", "src/debug/kotlin", "src/release/kotlin")
            .map { File(app, it) }
            .filter { it.isDirectory }
            .flatMap { root -> root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList() }
            .map { it.relativeTo(app).invariantSeparatorsPath to it.readText() }
            .filterNot { (path, _) -> path.contains("/generated/") || path.contains("/uniffi/") }
            .toMap()

    /** Every API that persists to disk on Android. */
    private val storage = Regex(
        """getSharedPreferences|getPreferences\(|PreferenceManager|DataStore|openFileOutput|FileOutputStream|""" +
            """FileWriter|\.writeText\(|\.writeBytes\(|\.appendText\(|SQLiteDatabase|Room\b|MODE_WORLD""",
    )

    @Test
    fun onlyTheKeystoreVaultTouchesStorage() {
        assertTrue("the guard sees the sources", sources.size > 5)
        val writers = sources.filterValues { storage.containsMatchIn(it) }.keys
        assertEquals(setOf(vaultFile, gatewayFile, pushFile), writers)
    }

    @Test
    fun thePushPreferencesStoreOnlyTheInstallationAndItsRegistration() {
        val push = sources.getValue(pushFile)
        val puts = Regex("""\bput\w*\((\w+),\s*([\w.]+)\)""").findAll(push).map { it.groupValues[1] to it.groupValues[2] }.toSet()
        assertEquals(
            setOf("KEY_INSTALLATION_ID" to "it", "KEY_TOKEN" to "value.token", "KEY_REGISTERED_AT" to "value.registeredAtUnixS"),
            puts,
        )
        assertEquals("nothing else is put", 3, Regex("""\bput\w*\(""").findAll(push).count())
        assertTrue(push.contains("newInstallationId()"))
        assertTrue(push.contains("Context.MODE_PRIVATE"))
        assertFalse("no session reaches it", Regex("""StoredSession|\bSessionVault\b|refreshToken|accessToken""").containsMatchIn(push))
    }

    @Test
    fun thePermissionGatewayStoresOnlyWhetherItAsked() {
        val gateway = sources.getValue(gatewayFile)
        // Preferences writes only (`putExtra` builds the Settings intent).
        val puts = Regex("""\.put(?:Boolean|String|StringSet|Int|Long|Float)\(""").findAll(gateway).map { it.value }.toList()
        assertEquals(listOf(".putBoolean("), puts)
        assertTrue(gateway.contains("putBoolean(askedKey(id), true)"))
        assertTrue(gateway.contains("Context.MODE_PRIVATE"))
    }

    @Test
    fun theVaultStoresOnlyCiphertextAndIv() {
        val vault = sources.getValue(vaultFile)
        val keys = Regex("""putString\((\w+),\s*(\w+)\)""").findAll(vault).map { it.groupValues[1] to it.groupValues[2] }.toSet()
        assertEquals(setOf("KEY_CIPHERTEXT" to "ciphertext", "KEY_IV" to "iv"), keys)
        assertFalse("nothing else is put", Regex("""put(Int|Long|Boolean|Float|StringSet)\(""").containsMatchIn(vault))
        assertTrue(vault.contains("val ciphertext = encode(sealed)"))
        assertTrue(vault.contains("\"AndroidKeyStore\""))
        assertTrue(vault.contains("AES/GCM/NoPadding"))
        assertTrue(vault.contains("setRandomizedEncryptionRequired(true)"))
        assertTrue(vault.contains("Context.MODE_PRIVATE"))
    }

    @Test
    fun noTokenOrSessionIsCompiledIntoBuildConfig() {
        val gradle = File(app, "build.gradle.kts").readText()
        val fields = Regex("""buildConfigField\(\s*"[^"]+",\s*"([^"]+)"""").findAll(gradle).map { it.groupValues[1] }.toList()
        assertTrue("the guard sees the fields", fields.isNotEmpty())
        for (field in fields) {
            assertFalse(field, Regex("TOKEN|SESSION|REFRESH|ACCESS|SECRET", RegexOption.IGNORE_CASE).containsMatchIn(field))
        }
    }

    @Test
    fun theDeprecatedSecurityLibraryIsNotUsed() {
        val gradle = File(app, "build.gradle.kts").readText()
        assertFalse(gradle.contains("androidx.security"))
        assertFalse(sources.values.any { it.contains("EncryptedSharedPreferences") })
    }

    @Test
    fun theAccessTokenIsNeverPartOfTheStoredRecord() {
        val record = sources.getValue("src/main/kotlin/com/tran/voting/session/SessionVault.kt")
        val fields = Regex("""class StoredSession\(([^)]*)\)""").find(record)!!.groupValues[1]
        assertFalse(fields.contains("access", ignoreCase = true))
        assertTrue(fields.contains("refreshToken"))
    }
}
