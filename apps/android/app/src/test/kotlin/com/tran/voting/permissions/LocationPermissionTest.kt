// Verifies: REQ-PRV-002 REQ-PRV-003 REQ-PRV-004 REQ-PRV-006
package com.tran.voting.permissions

import com.tran.voting.parity.VoteEligibilityParityTest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.TranPermissionStatus
import uniffi.tran_uniffi.TranPermissionStatus.DENIED
import uniffi.tran_uniffi.TranPermissionStatus.DENIED_PERMANENTLY
import uniffi.tran_uniffi.TranPermissionStatus.GRANTED
import uniffi.tran_uniffi.TranPermissionStatus.GRANTED_APPROXIMATE
import uniffi.tran_uniffi.TranPermissionStatus.NOT_DETERMINED
import uniffi.tran_uniffi.TranPermissionStatus.RESTRICTED

/**
 * "Use my location" against the staged gateway, which records every system request: each step of
 * `permissionStep`, each refusal, the fallback and the Settings note (spec 026).
 */
class LocationPermissionTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        /** Kathmandu, to a few hundred metres: what a coarse fix might be. */
        private val KATHMANDU = LocationFix(27.7172, 85.3240)
    }

    private val logged = mutableListOf<String>()

    private fun flow(
        gateway: PermissionGateway,
        geocoder: CountryGeocoder = CountryGeocoder { "NP" },
    ) = LocationCountry(gateway, geocoder, log = { level, line -> logged += "$level $line" })

    private fun staged(status: TranPermissionStatus, answer: TranPermissionStatus = DENIED, fix: LocationFix? = KATHMANDU) =
        StagedPermissionGateway(status, answer, fix)

    @Test
    fun `REQ-PRV-003 nothing is asked before a tap`() {
        val gateway = staged(NOT_DETERMINED)
        val location = flow(gateway)
        assertEquals(LocationPrompt.NONE, location.prompt)
        assertEquals(emptyList<TranPermissionId>(), gateway.requests)
        assertEquals(0, gateway.fixesTaken)
    }

    @Test
    fun `REQ-PRV-003 a first tap explains first and asks nothing`() = runBlocking {
        val gateway = staged(NOT_DETERMINED)
        val location = flow(gateway)
        assertNull(location.use())
        assertEquals(LocationPrompt.PRIMING, location.prompt)
        assertEquals("no system request before priming", emptyList<TranPermissionId>(), gateway.requests)
        assertEquals(0, gateway.fixesTaken)
    }

    @Test
    fun `REQ-PRV-003 Not now asks nothing and is not a refusal`() = runBlocking {
        val gateway = staged(NOT_DETERMINED)
        val location = flow(gateway)
        location.use()
        location.dismiss()
        assertEquals(LocationPrompt.NONE, location.prompt)
        assertEquals(emptyList<TranPermissionId>(), gateway.requests)
        assertEquals(NOT_DETERMINED, gateway.status(TranPermissionId.LOCATION_APPROXIMATE))
        // The next tap explains again rather than offering Settings.
        location.use()
        assertEquals(LocationPrompt.PRIMING, location.prompt)
        assertEquals(emptyList<TranPermissionId>(), gateway.requests)
    }

    @Test
    fun `REQ-PRV-006 Continue asks once and a grant fills the country from one fix`() = runBlocking {
        val gateway = staged(NOT_DETERMINED, answer = GRANTED_APPROXIMATE)
        val location = flow(gateway)
        location.use()
        assertEquals("NP", location.proceed())
        assertEquals(listOf(TranPermissionId.LOCATION_APPROXIMATE), gateway.requests)
        assertEquals(1, gateway.fixesTaken)
        assertEquals(LocationPrompt.NONE, location.prompt)
    }

    @Test
    fun `REQ-PRV-004 a first refusal keeps the country and explains again on the next tap`() = runBlocking {
        val gateway = staged(NOT_DETERMINED, answer = DENIED)
        val location = flow(gateway)
        location.use()
        assertNull("the typed country stays", location.proceed())
        assertEquals(LocationPrompt.NONE, location.prompt)
        assertEquals(0, gateway.fixesTaken)
        // Android can still ask: priming again, and the system prompt only after Continue.
        location.use()
        assertEquals(LocationPrompt.PRIMING, location.prompt)
        assertEquals(1, gateway.requests.size)
    }

    @Test
    fun `REQ-PRV-004 a permanent refusal falls back quietly, then the next tap offers Settings and never asks`() =
        runBlocking {
            val gateway = staged(DENIED, answer = DENIED_PERMANENTLY)
            val location = flow(gateway)
            location.use()
            assertEquals(LocationPrompt.PRIMING, location.prompt)
            assertNull(location.proceed())
            assertEquals("no note straight after the refusal", LocationPrompt.NONE, location.prompt)
            location.use()
            assertEquals(LocationPrompt.SETTINGS_NOTE, location.prompt)
            location.use()
            assertEquals("asked only once", 1, gateway.requests.size)
            assertEquals(0, gateway.fixesTaken)
        }

    @Test
    fun `REQ-PRV-004 refused for good offers Settings without asking or priming`() = runBlocking {
        for (status in listOf(DENIED_PERMANENTLY, RESTRICTED)) {
            val gateway = staged(status)
            val location = flow(gateway)
            assertNull(location.use())
            assertEquals("$status", LocationPrompt.SETTINGS_NOTE, location.prompt)
            location.openSettings()
            assertEquals("$status", 1, gateway.settingsOpened)
            assertEquals("$status", emptyList<TranPermissionId>(), gateway.requests)
            assertEquals("$status", 0, gateway.fixesTaken)
        }
    }

    @Test
    fun `REQ-PRV-002 granted goes straight to the feature`() = runBlocking {
        for (status in listOf(GRANTED, GRANTED_APPROXIMATE)) {
            val gateway = staged(status)
            val location = flow(gateway, geocoder = { "np" })
            assertEquals("$status", "NP", location.use())
            assertEquals("$status", LocationPrompt.NONE, location.prompt)
            assertEquals("$status", emptyList<TranPermissionId>(), gateway.requests)
        }
    }

    @Test
    fun `REQ-PRV-004 no fix, no geocoder answer or no country keeps the typed country`() = runBlocking {
        assertNull("no fix", flow(staged(GRANTED_APPROXIMATE, fix = null)).use())
        assertNull("no geocoder", flow(staged(GRANTED_APPROXIMATE), geocoder = NoCountryGeocoder).use())
        assertNull("not a country code", flow(staged(GRANTED_APPROXIMATE), geocoder = { "Nepal" }).use())
        assertNull("empty", flow(staged(GRANTED_APPROXIMATE), geocoder = { "" }).use())
        assertTrue(logged.all { "keep_manual_entry" in it || "step=" in it })
    }

    @Test
    fun `REQ-PRV-006 no coordinate reaches a log line`() = runBlocking {
        var seen: LocationFix? = null
        val location = flow(staged(NOT_DETERMINED, answer = GRANTED_APPROXIMATE), geocoder = { fix -> seen = fix; "NP" })
        location.use()
        location.proceed()
        assertSame("the geocoder gets the fix itself", KATHMANDU, seen)
        assertTrue(logged.isNotEmpty())
        for (line in logged) {
            assertFalse(line, "27.7" in line || "85.3" in line || "LocationFix(" in line && "redacted" !in line)
        }
        assertEquals("LocationFix(redacted)", "$KATHMANDU")
    }

    @Test
    fun `a debug build stages the launch extra, a release build always asks the system`() {
        val system = StagedPermissionGateway(GRANTED)
        val extra = "location_approximate=denied_permanently"
        assertEquals(TranPermissionId.LOCATION_APPROXIMATE to DENIED_PERMANENTLY, stagedPermission(extra))
        val debug = permissionGatewayFor(debug = true, extra = extra) { system }
        assertEquals(DENIED_PERMANENTLY, debug.status(TranPermissionId.LOCATION_APPROXIMATE))
        assertSame(system, permissionGatewayFor(debug = false, extra = extra) { system })
        assertSame(system, permissionGatewayFor(debug = true, extra = null) { system })
        for (bad in listOf("", "location_approximate", "camera=granted", "location_approximate=maybe", "a=b=c")) {
            assertNull(bad, stagedPermission(bad))
            assertSame(bad, system, permissionGatewayFor(debug = true, extra = bad) { system })
        }
    }
}
