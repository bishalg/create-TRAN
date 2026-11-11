// Verifies: REQ-PSH-010 REQ-DB-011
package com.tran.voting.push

import android.content.Context
import android.content.SharedPreferences
import uniffi.tran_uniffi.TranLastRegistration
import uniffi.tran_uniffi.TranStoredRecordAction
import uniffi.tran_uniffi.tranStoredPushSchema
import uniffi.tran_uniffi.tranStoredRecordDecision

/**
 * [PushStore] in plain `SharedPreferences` (`tran.push`, private to the app). The data-extraction
 * rules keep this file out of cloud backup and device transfer, so two devices never share one
 * installation id. `SessionVaultGuardTest` pins what it may write.
 */
class PushPreferences(
    private val preferences: SharedPreferences,
) : PushStore {
    constructor(context: Context) : this(context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE))

    override val installationId: String =
        preferences.getString(KEY_INSTALLATION_ID, null) ?: newInstallationId().also {
            preferences.edit().putString(KEY_INSTALLATION_ID, it).apply()
        }

    override var lastRegistration: TranLastRegistration?
        get() {
            val token = preferences.getString(KEY_TOKEN, null) ?: return null
            if (!preferences.contains(KEY_REGISTERED_AT)) return null
            val schema = preferences.getInt(KEY_SCHEMA, 1)
            val decision = tranStoredRecordDecision(schema.toUInt(), tranStoredPushSchema())
            return when (decision) {
                TranStoredRecordAction.USE ->
                    TranLastRegistration(token = token, registeredAtUnixS = preferences.getLong(KEY_REGISTERED_AT, 0))
                TranStoredRecordAction.UPGRADE -> {
                    preferences.edit().putInt(KEY_SCHEMA, tranStoredPushSchema().toInt()).apply()
                    TranLastRegistration(token = token, registeredAtUnixS = preferences.getLong(KEY_REGISTERED_AT, 0))
                }
                TranStoredRecordAction.DISCARD -> {
                    preferences.edit().remove(KEY_SCHEMA).remove(KEY_TOKEN).remove(KEY_REGISTERED_AT).apply()
                    null
                }
            }
        }
        set(value) {
            preferences.edit().apply {
                if (value == null) {
                    remove(KEY_SCHEMA)
                    remove(KEY_TOKEN)
                    remove(KEY_REGISTERED_AT)
                } else {
                    putInt(KEY_SCHEMA, tranStoredPushSchema().toInt())
                    putString(KEY_TOKEN, value.token)
                    putLong(KEY_REGISTERED_AT, value.registeredAtUnixS)
                }
            }.apply()
        }

    companion object {
        /** The file name `data_extraction_rules.xml` excludes (`tran.push.xml`). */
        const val PREFERENCES = "tran.push"
        private const val KEY_SCHEMA = "schema"
        private const val KEY_INSTALLATION_ID = "installation_id"
        private const val KEY_TOKEN = "registered_token"
        private const val KEY_REGISTERED_AT = "registered_at_unix_s"
    }
}
