// Verifies: REQ-SEC-020 REQ-DB-011 REQ-DB-012
package com.tran.voting.session

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONException
import org.json.JSONObject
import uniffi.tran_uniffi.TranStoredRecordAction
import uniffi.tran_uniffi.tranStoredRecordDecision
import uniffi.tran_uniffi.tranStoredSessionSchema

/**
 * The Android vault (ADR-0039 decision 4): the record is encrypted with AES-256-GCM under a key
 * that is generated inside, and never leaves, the Android Keystore. Only the ciphertext and its
 * IV reach app-private preferences, which the manifest keeps out of backup and device transfer.
 * No `androidx.security` (deprecated): platform APIs only.
 */
class KeystoreSessionVault(
    context: Context,
    private val keyAlias: String = KEY_ALIAS,
    preferencesName: String = PREFERENCES,
) : SessionVault {
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
        val record = try {
            // A restored backup or a wiped Keystore leaves ciphertext whose key is gone: no key, no record.
            val key = existingKey() ?: throw GeneralSecurityException("vault key missing")
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, decode(iv)))
            val decoded = decodeRecord(String(cipher.doFinal(decode(ciphertext)), Charsets.UTF_8))
            if (decoded != null && decoded.schema != tranStoredSessionSchema().toInt()) {
                val upgraded = StoredSession(decoded.userId, decoded.role, decoded.refreshToken, tranStoredSessionSchema().toInt())
                write(upgraded)
                upgraded
            } else {
                decoded
            }
        } catch (_: GeneralSecurityException) {
            null
        } catch (_: ProviderException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        } catch (_: JSONException) {
            null
        }
        // Unreadable is signed out, and the record must not linger (REQ-SEC-020).
        if (record == null) clear()
        return record
    }

    @Synchronized
    override fun write(session: StoredSession) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        // The Keystore chooses a fresh random IV for every encryption; callers cannot supply one.
        cipher.init(Cipher.ENCRYPT_MODE, existingKey() ?: generateKey())
        val sealed = cipher.doFinal(encodeRecord(session).toByteArray(Charsets.UTF_8))
        val ciphertext = encode(sealed)
        val iv = encode(cipher.iv)
        preferences.edit().putString(KEY_CIPHERTEXT, ciphertext).putString(KEY_IV, iv).commit()
    }

    @Synchronized
    override fun clear() {
        preferences.edit().clear().commit()
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

    companion object {
        const val PREFERENCES = "tran_session_vault"
        const val KEY_ALIAS = "tran_session_vault_key"
        const val KEY_CIPHERTEXT = "ciphertext"
        const val KEY_IV = "iv"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val KEY_BITS = 256
        private const val TAG_BITS = 128

        private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

        private fun decode(text: String): ByteArray = Base64.decode(text, Base64.NO_WRAP)

        private fun encodeRecord(session: StoredSession): String =
            JSONObject()
                .put("schema", tranStoredSessionSchema().toInt())
                .put("user_id", session.userId)
                .put("role", session.role.wire)
                .put("refresh_token", session.refreshToken)
                .toString()

        private fun decodeRecord(json: String): StoredSession? {
            val record = JSONObject(json)
            val schema = if (record.has("schema")) record.getInt("schema") else 1
            val decision = tranStoredRecordDecision(schema.toUInt(), tranStoredSessionSchema())
            if (decision == TranStoredRecordAction.DISCARD) {
                return null
            }
            val role = tranUserRoleFromWire(record.getString("role")) ?: return null
            val currentSchema = tranStoredSessionSchema().toInt()
            return StoredSession(
                record.getString("user_id"),
                role,
                record.getString("refresh_token"),
                schema = if (decision == TranStoredRecordAction.UPGRADE) currentSchema else schema
            )
        }
    }
}
