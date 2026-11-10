// Verifies: REQ-SEC-020
package com.tran.voting.session

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.security.KeyStore
import javax.crypto.SecretKey
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.tran_uniffi.TranUserRole

/** The real vault against the device's Android Keystore (ADR-0039: tested once, on a device). */
@RunWith(AndroidJUnit4::class)
class KeystoreSessionVaultTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val alias = "tran_session_vault_test_key"
    private val preferencesName = "tran_session_vault_test"
    private val preferences get() = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
    private val record = StoredSession("voter-001", TranUserRole.ELECTION_AUDITOR, "refresh-token-QWxhZGRpbjpvcGVuIHNlc2FtZQ")

    private fun vault() = KeystoreSessionVault(context, keyAlias = alias, preferencesName = preferencesName)

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    @Before
    @After
    fun reset() {
        preferences.edit().clear().commit()
        keyStore().deleteEntry(alias)
    }

    @Test
    fun roundTripsTheRecord() {
        assertNull(vault().read())
        vault().write(record)
        // A fresh instance reads it back: it is on disk, not only in memory.
        assertEquals(record, vault().read())
    }

    @Test
    fun storesOnlyCiphertextAndIv() {
        vault().write(record)
        val stored = preferences.all
        assertEquals(setOf(KeystoreSessionVault.KEY_CIPHERTEXT, KeystoreSessionVault.KEY_IV), stored.keys)
        for (value in stored.values.map { it.toString() }) {
            assertFalse(value.contains(record.refreshToken))
            assertFalse(value.contains(record.userId))
            assertFalse(value.contains("election_auditor"))
        }
    }

    @Test
    fun everyWriteUsesANewIv() {
        val vault = vault()
        vault.write(record)
        val first = preferences.getString(KeystoreSessionVault.KEY_IV, null)
        val firstCiphertext = preferences.getString(KeystoreSessionVault.KEY_CIPHERTEXT, null)
        vault.write(record)
        assertNotEquals(first, preferences.getString(KeystoreSessionVault.KEY_IV, null))
        assertNotEquals(firstCiphertext, preferences.getString(KeystoreSessionVault.KEY_CIPHERTEXT, null))
    }

    @Test
    fun theKeyIsAnAes256KeyThatCannotBeExported() {
        vault().write(record)
        val key = keyStore().getKey(alias, null) as SecretKey
        assertNotNull(key)
        assertEquals("AES", key.algorithm)
        // Keystore keys never hand out their material.
        assertNull(key.encoded)
    }

    @Test
    fun aTamperedRecordIsDeletedAndReadsAsSignedOut() {
        vault().write(record)
        val ciphertext = preferences.getString(KeystoreSessionVault.KEY_CIPHERTEXT, null)!!
        val flipped = (if (ciphertext.first() == 'A') "B" else "A") + ciphertext.drop(1)
        preferences.edit().putString(KeystoreSessionVault.KEY_CIPHERTEXT, flipped).commit()

        assertNull(vault().read())
        assertTrue(preferences.all.isEmpty())
    }

    @Test
    fun ciphertextWhoseKeyIsGoneIsDeletedAndReadsAsSignedOut() {
        // What a restored backup looks like: the ciphertext came back, the Keystore key did not.
        vault().write(record)
        keyStore().deleteEntry(alias)

        assertNull(vault().read())
        assertTrue(preferences.all.isEmpty())
    }

    @Test
    fun clearForgetsTheRecord() {
        vault().write(record)
        vault().clear()
        assertNull(vault().read())
        assertTrue(preferences.all.isEmpty())
        vault().clear()
    }
}
