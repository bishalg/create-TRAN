// Verifies: REQ-PSH-008 REQ-PSH-012 REQ-PSH-013
package com.tran.voting.push

import android.app.NotificationManager
import android.content.Intent
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import com.tran.voting.NavigationCoordinator
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranStrings
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.permissions.StagedPermissionGateway
import com.tran.voting.session.InMemorySessionVault
import com.tran.voting.session.StoredSession
import com.tran.voting.session.restoredSession
import com.tran.voting.testing.FakeApis
import com.tran.voting.ui.AuthSession
import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import uniffi.tran_uniffi.TranPermissionStatus
import uniffi.tran_uniffi.TranUserRole

/**
 * What a notification does to the app (spec 027): a tap goes through the navigation director with
 * the stored session, a message in the foreground is the catalogue's toast and never a system
 * notification, and the reminder control appears only with push and a below-minimum verdict.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NotificationHandlingTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }

    @get:Rule
    val compose = createComposeRule()

    private val app get() = RuntimeEnvironment.getApplication()

    private fun text(res: Int): String = app.getString(res)

    private fun present(tag: String) = compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()

    private fun voter() = AuthSession.Authenticated(userId = "voter-001", role = TranUserRole.CITIZEN_VOTER)

    private fun check(age: String, country: String) {
        compose.waitUntil(5_000) { present(ScreenContract.Eligibility.checkButton) }
        compose.onNodeWithTag(ScreenContract.Eligibility.ageField).performTextReplacement(age)
        compose.onNodeWithTag(ScreenContract.Eligibility.countryField).performTextReplacement(country)
        compose.onNodeWithTag(ScreenContract.Eligibility.checkButton).performScrollTo().performClick()
        compose.waitForIdle()
    }

    @Test
    fun `REQ-PSH-013 a tap with no stored session leads to Auth Welcome, never straight to a screen`() {
        val opens = NotificationOpens()
        val vault = InMemorySessionVault()
        compose.setContent {
            NavigationCoordinator(
                api = FakeApis.healthy(),
                initialSession = voter(),
                notificationOpens = opens,
                storedSession = { restoredSession(vault) },
            )
        }
        compose.waitUntil(5_000) { present(ScreenContract.Eligibility.checkButton) }
        compose.runOnIdle { opens.opened() }
        compose.waitUntil(5_000) { present(ScreenContract.AuthWelcome.voterBranchButton) }
        assertFalse(present(ScreenContract.Eligibility.checkButton))
    }

    @Test
    fun `REQ-PSH-013 a tap with a stored session goes where the director sends that role`() {
        val opens = NotificationOpens()
        val vault = InMemorySessionVault(StoredSession("auditor-001", TranUserRole.ELECTION_AUDITOR, "refresh-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))
        compose.setContent {
            NavigationCoordinator(
                api = FakeApis.healthy(),
                initialSession = AuthSession.Unauthenticated,
                notificationOpens = opens,
                storedSession = { restoredSession(vault) },
            )
        }
        compose.waitUntil(5_000) { present(ScreenContract.AuthWelcome.voterBranchButton) }
        compose.runOnIdle { opens.opened() }
        // The auditor dashboard: signed in, and not the voter's.
        compose.waitUntil(5_000) { present(ScreenContract.Auditor.signOutButton) }
        assertFalse(present(ScreenContract.Eligibility.checkButton))
        assertFalse(present(ScreenContract.AuthWelcome.voterBranchButton))
    }

    @Test
    fun `REQ-PSH-013 only the app's own notification types count as a tap`() {
        assertTrue(isNotificationOpen(Intent().putExtra("type", "eligibility.reached")))
        assertFalse(isNotificationOpen(Intent().putExtra("type", "something.else")))
        assertFalse(isNotificationOpen(Intent(Intent.ACTION_MAIN)))
        assertFalse(isNotificationOpen(null))
        // Every type the API builds a payload for (fixtures/push.json) is known here.
        val repoRoot = System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set")
        val payloads = JSONObject(File(repoRoot, "fixtures/push.json").readText()).getJSONArray("payloads")
        val types = (0 until payloads.length()).map { payloads.getJSONObject(it).getString("type") }.toSet()
        assertEquals(types, NOTIFICATION_TYPES)
    }

    @Test
    fun `REQ-PSH-013 a message in the foreground is the catalogue toast, not a system notification`() {
        val push = StagedPushGateway(available = true, current = STAGED_PUSH_TOKEN)
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy(), push = push) }
        compose.waitUntil(5_000) { present(ScreenContract.Eligibility.checkButton) }
        compose.runOnIdle { push.deliverMessage() }
        compose.waitUntil(5_000) { present(ScreenContract.Eligibility.toast) }
        assertTrue(compose.onAllNodes(hasText(text(TranStrings.Eligibility.notifyReceived))).fetchSemanticsNodes().isNotEmpty())
        val manager = app.getSystemService(NotificationManager::class.java)
        assertEquals(0, shadowOf(manager).allNotifications.size)
    }

    @Test
    fun `REQ-PSH-008 the control appears with push and a below-minimum verdict only`() {
        val push = StagedPushGateway(available = true, current = STAGED_PUSH_TOKEN)
        val permissions = StagedPermissionGateway(TranPermissionStatus.NOT_DETERMINED)
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy(), push = push, permissions = permissions) }
        compose.waitUntil(5_000) { present(ScreenContract.Eligibility.checkButton) }
        assertFalse("no verdict yet", present(ScreenContract.Eligibility.notifyMeButton))
        check("17", "US")
        compose.waitUntil(5_000) { present(ScreenContract.Eligibility.notifyMeButton) }
        assertEquals("nothing asked on display", emptyList<Any>(), permissions.requests)
        // The server check's toast sits over the foot of the screen: dismiss it, as a person would.
        compose.waitUntil(5_000) { present(ScreenContract.Eligibility.toastDismiss) }
        compose.onNodeWithTag(ScreenContract.Eligibility.toastDismiss).performClick()
        compose.onNodeWithTag(ScreenContract.Eligibility.notifyMeButton).performScrollTo().performClick()
        compose.waitUntil(5_000) { present(ScreenContract.Eligibility.notifyPrimingContinue) }
        assertTrue(compose.onAllNodes(hasText(text(TranStrings.Eligibility.notifyPrimingTitle))).fetchSemanticsNodes().isNotEmpty())
        assertEquals(emptyList<Any>(), permissions.requests)
        assertEquals("no token without a grant", 0, push.tokenRequests)
    }

    @Test
    fun `REQ-PSH-008 an eligible verdict offers no reminder`() {
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy(), push = stagedPushGateway(uniffi.tran_uniffi.TranPermissionId.NOTIFICATIONS)) }
        check("20", "NP")
        assertTrue(compose.onAllNodes(hasText("NP", substring = true)).fetchSemanticsNodes().isNotEmpty())
        assertFalse(present(ScreenContract.Eligibility.notifyMeButton))
    }

    @Test
    fun `REQ-PSH-012 without push the control never appears`() {
        compose.setContent { NavigationCoordinator(api = FakeApis.healthy()) }
        check("17", "US")
        assertFalse(present(ScreenContract.Eligibility.notifyMeButton))
    }

    @Test
    fun `REQ-PSH-012 the system gateway without build values is unavailable and starts nothing`() = runBlocking {
        val gateway = SystemPushGateway(app, config = null)
        assertFalse(gateway.available)
        assertNull(gateway.token())
        assertNull(SystemPushGateway.initialize(app, config = null))
        val manager = app.getSystemService(NotificationManager::class.java)
        assertNull("no channel without push", manager.getNotificationChannel(SystemPushGateway.CHANNEL_ID))
    }

    @Test
    fun `the notification channel is named from the strings and is the one FCM is told to use`() {
        SystemPushGateway.createChannel(app)
        val channel = app.getSystemService(NotificationManager::class.java).getNotificationChannel(SystemPushGateway.CHANNEL_ID)
        assertEquals(text(TranStrings.Eligibility.notifyLabel), channel.name)
        assertEquals(text(TranStrings.Eligibility.notifyPurpose), channel.description)
        val repoRoot = System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set")
        val manifest = File(repoRoot, "apps/android/app/src/main/AndroidManifest.xml").readText()
        assertTrue(
            Regex(
                """android:name="com\.google\.firebase\.messaging\.default_notification_channel_id"\s+android:value="${SystemPushGateway.CHANNEL_ID}"""",
            ).containsMatchIn(manifest),
        )
        assertTrue("auto-init is off", Regex("""firebase_messaging_auto_init_enabled"\s+android:value="false"""").containsMatchIn(manifest))
        assertTrue("the init provider is removed", Regex("""FirebaseInitProvider"[^>]*tools:node="remove"""").containsMatchIn(manifest))
    }

    @Test
    fun `REQ-PSH-010 the installation id is made once and kept in the push preferences`() {
        val preferences = app.getSharedPreferences(PushPreferences.PREFERENCES, android.content.Context.MODE_PRIVATE)
        preferences.edit().clear().commit()
        val first = PushPreferences(app)
        assertEquals(first.installationId, PushPreferences(app).installationId)
        assertNull(first.lastRegistration)
        first.lastRegistration = uniffi.tran_uniffi.TranLastRegistration("fcm-token-a:APA91bAAAAAAAAAAAAAAAAAAAAAAAA", 42)
        assertEquals(42L, PushPreferences(app).lastRegistration?.registeredAtUnixS)
        first.lastRegistration = null
        assertNull(PushPreferences(app).lastRegistration)
        assertEquals("the id outlives a sign-out", first.installationId, PushPreferences(app).installationId)
        preferences.edit().clear().commit()
        assertTrue("a reinstall gets a new one", PushPreferences(app).installationId != first.installationId)
    }
}
