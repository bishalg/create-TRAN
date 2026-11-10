// Verifies: REQ-PSH-008 REQ-PRV-002 REQ-PRV-003 REQ-PRV-004
package com.tran.voting.permissions

import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.push.NotificationReminder
import com.tran.voting.push.STAGED_PUSH_TOKEN
import com.tran.voting.push.pushGatewayFor
import com.tran.voting.push.stagedPushGateway
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.TranPermissionId.NOTIFICATIONS
import uniffi.tran_uniffi.TranPermissionStatus
import uniffi.tran_uniffi.TranPermissionStatus.DENIED
import uniffi.tran_uniffi.TranPermissionStatus.DENIED_PERMANENTLY
import uniffi.tran_uniffi.TranPermissionStatus.GRANTED
import uniffi.tran_uniffi.TranPermissionStatus.NOT_DETERMINED
import uniffi.tran_uniffi.TranPermissionStatus.RESTRICTED

/**
 * "Notify me when I can vote" against the staged gateway, mirroring `LocationPermissionTest`: the
 * system prompt only after a tap and Continue, a refusal that changes nothing, the Settings note,
 * and a grant that hands over to the sync (spec 027).
 */
class NotificationPermissionTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }

    private val logged = mutableListOf<String>()
    private var granted = 0

    private fun reminder(gateway: PermissionGateway) =
        NotificationReminder(gateway, onGranted = { granted += 1 }, log = { level, line -> logged += "$level $line" })

    private fun staged(status: TranPermissionStatus, answer: TranPermissionStatus = DENIED) = StagedPermissionGateway(status, answer)

    @Test
    fun `REQ-PSH-008 nothing is asked before a tap, and a first tap explains first`() = runBlocking {
        val gateway = staged(NOT_DETERMINED)
        val notify = reminder(gateway)
        assertEquals(PermissionPrompt.NONE, notify.prompt)
        notify.ask()
        assertEquals(PermissionPrompt.PRIMING, notify.prompt)
        assertEquals("no system request before priming", emptyList<TranPermissionId>(), gateway.requests)
        assertEquals(0, granted)
    }

    @Test
    fun `REQ-PRV-003 Not now asks nothing and is not a refusal`() = runBlocking {
        val gateway = staged(NOT_DETERMINED)
        val notify = reminder(gateway)
        notify.ask()
        notify.dismiss()
        assertEquals(PermissionPrompt.NONE, notify.prompt)
        notify.ask()
        assertEquals(PermissionPrompt.PRIMING, notify.prompt)
        assertEquals(emptyList<TranPermissionId>(), gateway.requests)
        assertTrue(logged.any { "notifications priming dismissed" in it })
    }

    @Test
    fun `REQ-PSH-008 Continue shows the system prompt once and a grant fetches the token`() = runBlocking {
        val gateway = staged(NOT_DETERMINED, answer = GRANTED)
        val notify = reminder(gateway)
        notify.ask()
        notify.proceed()
        assertEquals(listOf(NOTIFICATIONS), gateway.requests)
        assertEquals("the sync runs once", 1, granted)
        assertEquals(PermissionPrompt.NONE, notify.prompt)
    }

    @Test
    fun `REQ-PRV-004 a refusal changes nothing, and a permanent one offers Settings on the next tap`() = runBlocking {
        val gateway = staged(NOT_DETERMINED, answer = DENIED_PERMANENTLY)
        val notify = reminder(gateway)
        notify.ask()
        notify.proceed()
        assertEquals("no note straight after the refusal", PermissionPrompt.NONE, notify.prompt)
        assertEquals(0, granted)
        assertTrue(logged.any { "notifications fallback=no_reminder why=refused" in it })
        notify.ask()
        assertEquals(PermissionPrompt.SETTINGS_NOTE, notify.prompt)
        notify.openSettings()
        assertEquals(listOf(NOTIFICATIONS), gateway.settingsFor)
        assertEquals("asked only once", 1, gateway.requests.size)
    }

    @Test
    fun `REQ-PRV-004 refused for good or restricted offers Settings without asking`() = runBlocking {
        for (status in listOf(DENIED_PERMANENTLY, RESTRICTED)) {
            val gateway = staged(status)
            val notify = reminder(gateway)
            notify.ask()
            assertEquals("$status", PermissionPrompt.SETTINGS_NOTE, notify.prompt)
            assertEquals("$status", emptyList<TranPermissionId>(), gateway.requests)
        }
        assertEquals(0, granted)
    }

    @Test
    fun `REQ-PRV-002 granted goes straight to the sync`() = runBlocking {
        val gateway = staged(GRANTED)
        reminder(gateway).ask()
        assertEquals(1, granted)
        assertEquals(emptyList<TranPermissionId>(), gateway.requests)
    }

    @Test
    fun `a staged notifications permission stages push, anything else leaves it unavailable`() = runBlocking {
        val available = stagedPushGateway(NOTIFICATIONS)
        assertTrue(available.available)
        assertEquals(STAGED_PUSH_TOKEN, available.token())
        assertTrue("the fake token has an FCM token's shape", Regex("^[A-Za-z0-9_:-]{32,1024}$").matches(STAGED_PUSH_TOKEN))
        assertFalse(stagedPushGateway(TranPermissionId.LOCATION_APPROXIMATE).available)
        assertFalse(stagedPushGateway(null).available)
        val system = stagedPushGateway(null)
        assertSame(system, pushGatewayFor(debug = false, extra = "notifications=granted") { system })
        assertSame(system, pushGatewayFor(debug = true, extra = null) { system })
        assertTrue(pushGatewayFor(debug = true, extra = "notifications=not_determined") { system }.available)
        assertFalse(pushGatewayFor(debug = true, extra = "location_approximate=granted") { system }.available)
    }
}
