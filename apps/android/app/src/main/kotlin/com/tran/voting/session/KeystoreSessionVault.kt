// Verifies: REQ-SEC-020 REQ-DB-011 REQ-DB-012
package com.tran.voting.session

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.tran.voting.storage.StoredSchema
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONException
import org.json.JSONObject
import uniffi.tran_uniffi.tranStoredSessionSchema

/**
 * The Android vault (ADR-0039 decision 4): the record is encrypted with AES-256-GCM under a key
 * that is generated inside, and never leaves, the Android Keystore. Only the ciphertext and its
 * IV reach app-private preferences, which the manifest keeps out of backup and device transfer.
 * No `androidx.security` (deprecated): platform APIs only.
 *
 * Reading never writes (REQ-DB-011, REQ-DB-012): an older record is read into the current shape and
 * stored again only by the next rotation; a newer app version's record is signed out and left in
 * place; only an unreadable record is deleted (REQ-SEC-020).
 */
class KeystoreSessionVault internal constructor(
    context: Context,
    preferencesName: String,
    private val cipher: VaultCipher,
) : SessionVault {
    constructor(
        context: Context,
        keyAlias: String = KEY_ALIAS,
        preferencesName: String = PREFERENCES,
    ) : this(context, preferencesName, KeystoreVaultCipher(keyAlias))

    private val preferences: SharedPreferences =
        context.applicationContext.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)

    @Synchronized
    override fun read(): StoredSession? {
        val ciphertext = preferences.getString(KEY_CIPHERTEXT, null)
        val iv = preferences.getString(KEY_IV, null)
        if (ciphertext == null || iv == null) {
            if (ciphertext != null || iv != null) clear()
            return null
        }
        val stored = try {
            // A restored backup or a wiped Keystore leaves ciphertext whose key is gone: no key, no record.
            decodeRecord(String(cipher.open(decode(ciphertext), decode(iv)), Charsets.UTF_8))
        } catch (_: GeneralSecurityException) {
            Stored.Unreadable
        } catch (_: ProviderException) {
            Stored.Unreadable
        } catch (_: IllegalArgumentException) {
            Stored.Unreadable
        }
        return when (stored) {
            is Stored.Session -> stored.session
            // A newer app version wrote it: signed out here, left in place for that version.
            Stored.Newer -> null
            // Unreadable is signed out, and the record must not linger (REQ-SEC-020).
            Stored.Unreadable -> {
                clear()
                null
            }
        }
    }

    @Synchronized
    override fun write(session: StoredSession) {
        val (sealed, sealedIv) = cipher.seal(encodeRecord(session).toByteArray(Charsets.UTF_8))
        val ciphertext = encode(sealed)
        val iv = encode(sealedIv)
        preferences.edit().putString(KEY_CIPHERTEXT, ciphertext).putString(KEY_IV, iv).commit()
    }

    @Synchronized
    override fun clear() {
        preferences.edit().clear().commit()
    }

    /** What the decrypted record comes to. */
    internal sealed interface Stored {
        class Session(val session: StoredSession) : Stored

        data object Newer : Stored

        data object Unreadable : Stored
    }

    companion object {
        const val PREFERENCES = "tran_session_vault"
        const val KEY_ALIAS = "tran_session_vault_key"
        const val KEY_CIPHERTEXT = "ciphertext"
        const val KEY_IV = "iv"

        private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

        private fun decode(text: String): ByteArray = Base64.decode(text, Base64.NO_WRAP)

        private fun encodeRecord(session: StoredSession): String =
            JSONObject()
                .put("schema", tranStoredSessionSchema().toInt())
                .put("user_id", session.userId)
                .put("role", session.role.wire)
                .put("refresh_token", session.refreshToken)
                .toString()

        /** Reads a record of any version this or an earlier release wrote; never coerces a mistyped field. */
        internal fun decodeRecord(json: String): Stored {
            val record = try {
                JSONObject(json)
            } catch (_: JSONException) {
                return Stored.Unreadable
            }
            val current = tranStoredSessionSchema()
            when (StoredSchema.verdict(record.has("schema"), record.opt("schema"), current)) {
                StoredSchema.Verdict.NEWER -> return Stored.Newer
                StoredSchema.Verdict.UNREADABLE -> return Stored.Unreadable
                StoredSchema.Verdict.USE -> Unit
            }
            val userId = record.opt("user_id") as? String ?: return Stored.Unreadable
            val roleWire = record.opt("role") as? String ?: return Stored.Unreadable
            val refreshToken = record.opt("refresh_token") as? String ?: return Stored.Unreadable
            val role = tranUserRoleFromWire(roleWire) ?: return Stored.Unreadable
            return Stored.Session(StoredSession(userId, role, refreshToken, schema = current.toInt()))
        }
    }
}

/** Seals and opens the vault record: the Keystore in the app; a software key in the JVM suite, which has no Keystore. */
internal interface VaultCipher {
    /** Encrypts with a fresh IV the cipher chooses; returns the ciphertext and that IV. */
    fun seal(plain: ByteArray): Pair<ByteArray, ByteArray>

    /** Decrypts, or throws [GeneralSecurityException] / [ProviderException] when the key is gone or the bytes are not its own. */
    fun open(ciphertext: ByteArray, iv: ByteArray): ByteArray
}

/** AES-256-GCM under a non-exportable key in the `"AndroidKeyStore"` (REQ-SEC-020). */
internal class KeystoreVaultCipher(private val keyAlias: String) : VaultCipher {
    override fun seal(plain: ByteArray): Pair<ByteArray, ByteArray> {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        // The Keystore chooses a fresh random IV for every encryption; callers cannot supply one.
        cipher.init(Cipher.ENCRYPT_MODE, existingKey() ?: generateKey())
        return cipher.doFinal(plain) to cipher.iv
    }

    override fun open(ciphertext: ByteArray, iv: ByteArray): ByteArray {
        val key = existingKey() ?: throw GeneralSecurityException("vault key missing")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        return cipher.doFinal(ciphertext)
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    private fun existingKey(): SecretKey? = keyStore().getKey(keyAlias, null) as? SecretKey

    private fun generateKey(): SecretKey {
        val spec = KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(KEY_BITS)
            .setRandomizedEncryptionRequired(true)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
            .apply { init(spec) }
            .generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_BITS = 256
        const val TAG_BITS = 128
    }
}
