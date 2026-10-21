// Verifies: REQ-NAT-012
package com.tran.voting.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

class TranReferenceDateTests {
    /** 2026-10-20 23:30 UTC — already the 21st in Kathmandu (UTC+5:45). */
    private val instant = Instant.parse("2026-10-20T23:30:00Z")

    @Test
    fun isTheUtcDateWhateverTheDeviceZone() {
        val kathmandu = Clock.fixed(instant, ZoneId.of("Asia/Kathmandu"))
        assertEquals("2026-10-20", tranReferenceDate(kathmandu))
    }

    @Test
    fun isIsoWhateverTheDeviceLocale() {
        val saved = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ne-NP-u-nu-deva"))
            assertEquals("2026-10-20", tranReferenceDate(Clock.fixed(instant, ZoneId.of("UTC"))))
        } finally {
            Locale.setDefault(saved)
        }
    }
}
