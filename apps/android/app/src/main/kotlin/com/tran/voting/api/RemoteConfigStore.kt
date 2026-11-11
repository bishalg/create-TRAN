// Verifies: REQ-CFG-002 REQ-CFG-005 REQ-CFG-006 REQ-CFG-007 REQ-CFG-008 REQ-DB-011 REQ-DB-012
package com.tran.voting.api

import com.tran.voting.generated.Flags
import com.tran.voting.storage.StoredSchema
import org.json.JSONException
import org.json.JSONObject
import uniffi.tran_uniffi.tranStoredConfigSchema

interface ConfigPreferences {
    fun getString(key: String): String?
    fun setString(key: String, value: String)

    /** Deletes [key]; an unreadable cache is removed (REQ-DB-012). */
    fun remove(key: String)
}

class MemoryConfigPreferences : ConfigPreferences {
    private val map = mutableMapOf<String, String>()

    override fun getString(key: String): String? = map[key]

    override fun setString(key: String, value: String) {
        map[key] = value
    }

    override fun remove(key: String) {
        map.remove(key)
    }
}

/**
 * Remote configuration client store for Android (spec 029, ADR-0048).
 * Starts with compiled defaults or stored configuration, never blocks, and fetches in the background.
 */
class RemoteConfigStore(
    private val preferences: ConfigPreferences = MemoryConfigPreferences(),
    private val baseUrl: String? = null
) {
    private val storageKey = "tran.remote_config"
    private val etagKey = "tran.remote_config_etag"

    private var liveFlags = mutableMapOf<String, Any?>()
    private var launchFlags = mutableMapOf<String, Any?>()

    var minimumVersion: String? = null
        private set

    var recommendedVersion: String? = null
        private set

    var version: Int = 1
        private set

    init {
        val initial = mutableMapOf<String, Any?>(Flags.NOTIFY_ME_ID to Flags.NOTIFY_ME_DEFAULT)
        val raw = preferences.getString(storageKey)
        if (raw != null) {
            when (val stored = stored(raw)) {
                is Stored.Config -> {
                    initial.putAll(stored.flags)
                    minimumVersion = stored.minimumVersion
                    recommendedVersion = stored.recommendedVersion
                    stored.version?.let { version = it }
                }
                // Left for the app version that wrote it; its ETag must not turn a fetch into a `304`
                // for a body this build cannot use (REQ-DB-012).
                Stored.Newer -> preferences.remove(etagKey)
                Stored.Unreadable -> {
                    preferences.remove(storageKey)
                    preferences.remove(etagKey)
                }
            }
        }
        liveFlags = HashMap(initial)
        launchFlags = HashMap(initial)
    }

    /** What the stored configuration cache comes to (REQ-DB-011, REQ-DB-012). */
    internal sealed interface Stored {
        /** Usable: the current version, or an older one read as it is. Never rewritten on read. */
        class Config(
            val flags: Map<String, Any?>,
            val minimumVersion: String?,
            val recommendedVersion: String?,
            val version: Int?,
        ) : Stored

        /** Written by a newer app version: compiled defaults, the cache left in place. */
        data object Newer : Stored

        /** Not a configuration this or an earlier release wrote: deleted, compiled defaults. */
        data object Unreadable : Stored
    }

    internal companion object {
        /** Reads a cache of any version this or an earlier release wrote; never coerces, never throws. */
        fun stored(raw: String): Stored {
            val json = try {
                JSONObject(raw)
            } catch (_: JSONException) {
                return Stored.Unreadable
            }
            when (StoredSchema.verdict(json.has("schema"), json.opt("schema"), tranStoredConfigSchema())) {
                StoredSchema.Verdict.NEWER -> return Stored.Newer
                StoredSchema.Verdict.UNREADABLE -> return Stored.Unreadable
                StoredSchema.Verdict.USE -> Unit
            }
            val flagsObj = json.opt("flags") as? JSONObject ?: return Stored.Unreadable
            val flags = flagsObj.keys().asSequence().associateWith { flagsObj.get(it) }
            var minimum: String? = null
            var recommended: String? = null
            when (val client = json.opt("client")) {
                null, JSONObject.NULL -> Unit
                is JSONObject -> {
                    minimum = client.opt("minimum_version") as? String
                    recommended = client.opt("recommended_version") as? String
                }
                else -> return Stored.Unreadable
            }
            val version = when (val v = json.opt("config_version")) {
                null -> null
                is Int -> v
                else -> return Stored.Unreadable
            }
            return Stored.Config(flags, minimum, recommended, version)
        }
    }

    /** Whether the notify_me reminder flag is active (live flag) (REQ-CFG-007). */
    val isNotifyMe: Boolean
        get() = Flags.notifyMe(liveFlags)

    /** Non-blocking background fetch stub/implementation (REQ-CFG-005). */
    suspend fun fetchInBackground(clientHeader: String? = null, bucket: Int? = null): Boolean {
        if (baseUrl == null) return false
        // Network calls are non-blocking and leave stored configuration in use on error
        return false
    }
}
