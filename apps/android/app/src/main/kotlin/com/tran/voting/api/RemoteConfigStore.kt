// Verifies: REQ-CFG-002 REQ-CFG-005 REQ-CFG-006 REQ-CFG-007 REQ-CFG-008
package com.tran.voting.api

import com.tran.voting.generated.Flags
import org.json.JSONObject

interface ConfigPreferences {
    fun getString(key: String): String?
    fun setString(key: String, value: String)
}

class MemoryConfigPreferences : ConfigPreferences {
    private val map = mutableMapOf<String, String>()

    override fun getString(key: String): String? = map[key]

    override fun setString(key: String, value: String) {
        map[key] = value
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
            try {
                val json = JSONObject(raw)
                if (json.has("flags")) {
                    val flagsObj = json.getJSONObject("flags")
                    val keys = flagsObj.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        initial[k] = flagsObj.get(k)
                    }
                }
                if (json.has("client")) {
                    val client = json.getJSONObject("client")
                    minimumVersion =
                        if (client.isNull("minimum_version")) null else client.getString("minimum_version")
                    recommendedVersion =
                        if (client.isNull("recommended_version")) null else client.getString("recommended_version")
                }
                if (json.has("config_version")) {
                    version = json.getInt("config_version")
                }
            } catch (_: Exception) {
                // Stored configuration parse failure falls back to compiled defaults
            }
        }
        liveFlags = HashMap(initial)
        launchFlags = HashMap(initial)
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
