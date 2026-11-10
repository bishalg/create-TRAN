// Verifies: REQ-PRV-003 REQ-PRV-004 REQ-PRV-006 REQ-PRV-007
package com.tran.voting.ui

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import com.tran.voting.NavigationCoordinator
import com.tran.voting.api.TranApiClient
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranStrings
import com.tran.voting.parity.VoteEligibilityParityTest
import com.tran.voting.permissions.CountryGeocoder
import com.tran.voting.permissions.LocationFix
import com.tran.voting.permissions.StagedPermissionGateway
import kotlinx.coroutines.Dispatchers
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uniffi.tran_uniffi.TranPermissionStatus

/** "Use my location" on the voter dashboard, with a staged gateway and a recording API (spec 026). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class UseLocationControlTest {
    @get:Rule
    val compose = createComposeRule()

    /** Every request the app sends: method, URL, headers and body. */
    private val sent = mutableListOf<String>()

    private val api = TranApiClient(
        baseUrl = "http://api.test",
        includeDebugCountry = true,
        http = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val body = request.body?.let { Buffer().also(it::writeTo).readUtf8() }.orEmpty()
            synchronized(sent) { sent += "${request.method} ${request.url} ${request.headers} $body" }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body("{}".toResponseBody("application/json".toMediaType())).build()
        }.build(),
        io = Dispatchers.Unconfined,
    )

    private fun text(res: Int): String = RuntimeEnvironment.getApplication().getString(res)

    private fun launch(gateway: StagedPermissionGateway, geocoder: CountryGeocoder = CountryGeocoder { "IN" }) {
        compose.setContent { NavigationCoordinator(api = api, permissions = gateway, geocoder = geocoder) }
        compose.waitUntil(5_000) { present(ScreenContract.Eligibility.useLocationButton) }
    }

    private fun present(tag: String) = compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()

    private fun tap(tag: String) {
        compose.onNodeWithTag(tag).performScrollTo().performClick()
        compose.waitForIdle()
    }

    private fun country(): String? = compose.onNodeWithTag(ScreenContract.Eligibility.countryField)
        .fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text

    @Test
    fun `REQ-PRV-003 the screen asks nothing on display and primes with the catalogue copy`() {
        val gateway = StagedPermissionGateway(TranPermissionStatus.NOT_DETERMINED)
        launch(gateway)
        assertEquals(emptyList<Any>(), gateway.requests)
        assertFalse(present(ScreenContract.Eligibility.locationPrimingContinue))
        tap(ScreenContract.Eligibility.useLocationButton)
        assertTrue(compose.onAllNodes(hasText(text(TranStrings.Eligibility.locationPrimingTitle))).fetchSemanticsNodes().isNotEmpty())
        assertTrue(compose.onAllNodes(hasText(text(TranStrings.Eligibility.locationPrimingBody))).fetchSemanticsNodes().isNotEmpty())
        assertEquals(emptyList<Any>(), gateway.requests)
        compose.onNodeWithTag(ScreenContract.Eligibility.locationPrimingDismiss).performClick()
        compose.waitForIdle()
        assertFalse(present(ScreenContract.Eligibility.locationPrimingContinue))
        assertEquals(emptyList<Any>(), gateway.requests)
        assertEquals("NP", country())
    }

    @Test
    fun `REQ-PRV-006 a grant fills the country and no coordinate is sent`() {
        val gateway = StagedPermissionGateway(
            TranPermissionStatus.NOT_DETERMINED,
            answer = TranPermissionStatus.GRANTED_APPROXIMATE,
            fix = LocationFix(28.6139, 77.2090),
        )
        launch(gateway)
        tap(ScreenContract.Eligibility.useLocationButton)
        compose.onNodeWithTag(ScreenContract.Eligibility.locationPrimingContinue).performClick()
        compose.waitUntil(5_000) { country() == "IN" }
        assertEquals(1, gateway.requests.size)
        compose.onNodeWithTag(ScreenContract.Eligibility.ageField).performTextReplacement("20")
        tap(ScreenContract.Eligibility.checkButton)
        compose.waitUntil(5_000) { synchronized(sent) { sent.any { "/api/vote/eligibility" in it } } }
        val requests = synchronized(sent) { sent.toList() }
        assertTrue("the check still names the country: $requests", requests.any { "X-Debug-Country: IN" in it })
        for (request in requests) {
            assertFalse(request, listOf("28.6", "77.2", "lat", "lon").any { it in request })
        }
    }

    @Test
    fun `REQ-PRV-004 a permanent refusal keeps the country and offers Settings once, quietly`() {
        val gateway = StagedPermissionGateway(TranPermissionStatus.DENIED_PERMANENTLY)
        launch(gateway)
        tap(ScreenContract.Eligibility.useLocationButton)
        compose.waitUntil(5_000) { present(ScreenContract.Eligibility.locationSettingsNote) }
        assertTrue(compose.onAllNodes(hasText(text(TranStrings.Eligibility.locationSettingsNote))).fetchSemanticsNodes().isNotEmpty())
        assertFalse(present(ScreenContract.Eligibility.locationPrimingContinue))
        assertFalse("nothing is an error", present(ScreenContract.Eligibility.validationMessage))
        assertFalse("nothing is an error", present(ScreenContract.Eligibility.offlineNotice))
        tap(ScreenContract.Eligibility.locationOpenSettings)
        assertEquals(1, gateway.settingsOpened)
        assertEquals(emptyList<Any>(), gateway.requests)
        assertEquals("NP", country())
    }

    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }
}
