// Verifies: REQ-PSH-009 REQ-PSH-012
package com.tran.voting.push

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.tran.voting.permissions.LocationFix
import com.tran.voting.permissions.PermissionGateway
import com.tran.voting.session.InMemorySessionVault
import com.tran.voting.session.SessionClient
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Ignore
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.TranPermissionStatus
import uniffi.tran_uniffi.TranPushAction
import uniffi.tran_uniffi.TranUserRole

/**
 * End to end on a device with a real Firebase project (ADR-0046): the build's FCM values start
 * Firebase, FCM issues a token, and the sync registers it with the API (`pnpm dev:api` on the host).
 * Build with the four variables set, run on an emulator with Google Play services, then delete the
 * skip.
 */
@RunWith(AndroidJUnit4::class)
class FcmRegistrationTest {
    /** The person granted notifications; the system prompt itself is not what this proves. */
    private object Granted : PermissionGateway {
        override fun status(id: TranPermissionId) = TranPermissionStatus.GRANTED
        override suspend fun request(id: TranPermissionId) = TranPermissionStatus.GRANTED
        override suspend fun locationFix(): LocationFix? = null
        override fun openSettings(id: TranPermissionId) = Unit
    }

    @Test
    @Ignore("TODO(credentials): TRAN_FCM_PROJECT_ID, TRAN_FCM_APP_ID, TRAN_FCM_API_KEY, TRAN_FCM_SENDER_ID - a real FCM token is issued and registered")
    fun aRealTokenIsIssuedAndRegistered() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val gateway = SystemPushGateway(context)
        assertTrue("the build has the four FCM values", gateway.available)
        val token = gateway.token()
        assertNotNull("FCM issued a token", token)
        token!!
        assertTrue("an FCM token's shape", Regex("^[A-Za-z0-9_:-]{32,1024}$").matches(token))

        val sessions = SessionClient(InMemorySessionVault())
        sessions.signIn(TranUserRole.CITIZEN_VOTER)
        val store = InMemoryPushStore()
        val registration = PushRegistration(gateway, Granted, sessions, store)
        assertEquals(TranPushAction.REGISTER, registration.sync(PushTrigger.SIGN_IN))
        assertEquals("the API answered 204 and the token is recorded", token, store.lastRegistration?.token)
        assertEquals(TranPushAction.NOTHING, registration.sync(PushTrigger.FOREGROUND))
    }
}
