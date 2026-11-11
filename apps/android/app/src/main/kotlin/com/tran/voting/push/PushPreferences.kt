// Verifies: REQ-PSH-010 REQ-DB-011 REQ-DB-012
package com.tran.voting.push

import android.content.Context
import android.content.SharedPreferences
import com.tran.voting.storage.StoredSchema
import uniffi.tran_uniffi.TranLastRegistration
import uniffi.tran_uniffi.tranStoredPushSchema

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

    /**
     * The registration the API answered `204` to (REQ-DB-011). An older version is read as it is; a
     * newer one is left for the app version that wrote it; an unreadable one (a mistyped value, an
     * invalid `schema`) is removed. Reading never writes, and never throws on a mistyped value.
     */
    override var lastRegistration: TranLastRegistration?
        get() {
            val stored = preferences.all
            if (REGISTRATION_KEYS.none { it in stored }) return null
            when (StoredSchema.verdict(KEY_SCHEMA in stored, stored[KEY_SCHEMA], tranStoredPushSchema())) {
                StoredSchema.Verdict.NEWER -> return null
                StoredSchema.Verdict.UNREADABLE -> return forget()
                StoredSchema.Verdict.USE -> Unit
            }
            val token = stored[KEY_TOKEN] as? String ?: return forget()
            val registeredAt = when (val at = stored[KEY_REGISTERED_AT]) {
                is Long -> at
                is Int -> at.toLong()
                else -> return forget()
            }
            return TranLastRegistration(token = token, registeredAtUnixS = registeredAt)
        }
        set(value) {
            val schema = tranStoredPushSchema().toInt()
            preferences.edit().apply {
                if (value == null) {
                    REGISTRATION_KEYS.forEach { remove(it) }
                } else {
                    putInt(KEY_SCHEMA, schema)
                    putString(KEY_TOKEN, value.token)
                    putLong(KEY_REGISTERED_AT, value.registeredAtUnixS)
                }
            }.apply()
        }

    private fun forget(): TranLastRegistration? {
        lastRegistration = null
        return null
    }

    companion object {
        /** The file name `data_extraction_rules.xml` excludes (`tran.push.xml`). */
        const val PREFERENCES = "tran.push"
        private const val KEY_SCHEMA = "schema"
        private const val KEY_INSTALLATION_ID = "installation_id"
        private const val KEY_TOKEN = "registered_token"
        private const val KEY_REGISTERED_AT = "registered_at_unix_s"
        private val REGISTRATION_KEYS = listOf(KEY_SCHEMA, KEY_TOKEN, KEY_REGISTERED_AT)
    }
}
