// Verifies: REQ-CFG-002 REQ-CFG-005 REQ-CFG-006 REQ-CFG-007 REQ-CFG-008
package com.tran.voting.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteConfigTest {
    @Test
    fun startsWithCompiledDefaultsWhenStorageIsEmpty() {
        val store = RemoteConfigStore()
        assertFalse(store.isNotifyMe)
        assertEquals(1, store.version)
        assertNull(store.minimumVersion)
        assertNull(store.recommendedVersion)
    }

    @Test
    fun startsWithStoredConfigurationWhenPresent() {
        val prefs = MemoryConfigPreferences()
        prefs.setString(
            "tran.remote_config",
            """
            {
                "config_version": 4,
                "flags": {
                    "notify_me": true
                },
                "client": {
                    "minimum_version": "1.3.0",
                    "recommended_version": "1.5.0"
                }
            }
            """.trimIndent()
        )

        val store = RemoteConfigStore(preferences = prefs)
        assertTrue(store.isNotifyMe)
        assertEquals(4, store.version)
        assertEquals("1.3.0", store.minimumVersion)
        assertEquals("1.5.0", store.recommendedVersion)
    }
}
