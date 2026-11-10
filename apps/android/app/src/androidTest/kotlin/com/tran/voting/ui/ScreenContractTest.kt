// Verifies: REQ-SCR-006 REQ-SCR-007 REQ-SCR-008
// Verifies: REQ-A11Y-003 REQ-A11Y-007 REQ-ERR-006 REQ-ERR-007 REQ-LOAD-003 REQ-LOAD-005 REQ-NAT-001 REQ-NAT-002
// Verifies: REQ-NAT-003 REQ-NAT-004 REQ-NAT-007 REQ-NAT-011 REQ-NAT-013 REQ-NAV-001 REQ-NAV-002 REQ-NAV-003
// Verifies: REQ-NAV-004 REQ-NAV-005 REQ-WEB-001 REQ-WEB-002 REQ-WEB-004 REQ-WEB-014
// Verifies: REQ-ACC-004 REQ-ACC-005 REQ-ACC-006
// Verifies: REQ-PRV-003 REQ-PRV-004 REQ-PRV-007
package com.tran.voting.ui

import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.Density
import com.tran.voting.NavigationCoordinator
import com.tran.voting.api.TranApiClient
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranTheme
import com.tran.voting.permissions.StagedPermissionGateway
import com.tran.voting.permissions.stagedPermission
import com.tran.voting.ui.atoms.optionTag
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import uniffi.tran_uniffi.TranUserRole
import java.util.Locale

/**
 * The Android interpreter of the screen contract (ADR-0038): one test per scenario of
 * `screens.json`, named after it, and nothing written per scenario. Each verb of the closed set
 * maps to one Compose test action or assertion over contract ids, on the app's own
 * `NavigationCoordinator`; copy is resolved through the generated string resources and sizes come
 * from `ScreenContract.Minimums`. The `Verifies` header lists what the scenarios cite;
 * `packages/core-ts/tests/screen-ids.test.ts` keeps it equal to the catalogue. After the given
 * state, every `When` and the last `Then`, the semantics tree is recorded for `pnpm screens:check`
 * (`ConformanceManifest`, REQ-SCR-008).
 */
@RunWith(Parameterized::class)
class ScreenContractTest(private val name: String) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun scenarios(): List<String> = ScreenCatalogue.shared.screens.flatMap { screen -> screen.scenarios.map { it.name } }
    }

    @get:Rule
    val compose = createComposeRule()

    private val screen: ContractScreen
    private val scenario: ContractScenario

    init {
        val (screen, scenario) = ScreenCatalogue.shared.scenario(name)
        this.screen = screen
        this.scenario = scenario
    }

    private val driver by lazy { ContractScreenDriver(compose, screen, scenario) }

    // The launch state, from the givens.
    private var session: AuthSession = AuthSession.Authenticated(userId = "voter-001", role = TranUserRole.CITIZEN_VOTER)
    private var apiUnreachable = false
    private var localeTag = "en"
    private var theme = TranTheme.DARK
    private var largestText = false
    // No system dialog can appear: without a `permission` given the gateway is staged at "never asked".
    private var permissions = StagedPermissionGateway()
    private var launched = false
    private var checkedReach = false

    @Test
    fun runsTheScenario() {
        unsupported()?.let { assumeTrue("${scenario.name}: $it", false) }
        scenario.given.forEach(::given)
        scenario.whens.forEach(::whenStep)
        scenario.thens.forEach(::thenStep)
        record("then")
    }

    private fun record(phase: String) = ConformanceManifest.record(compose, scenario.name, phase, localeTag)

    /** What this platform cannot stage, said once per verb. */
    private fun unsupported(): String? {
        val verbs = (scenario.given + scenario.whens).map { it.verb }.toSet()
        return when {
            "reduced_motion" in verbs ->
                "the Compose rule cannot switch the system animation scale for one test"
            "go_offline" in verbs || "go_online" in verbs ->
                "the instrumentation cannot cut the emulator's network for the app alone mid-scenario"
            "api_reachable" in verbs && !apiAnswers() ->
                "the scenario needs a reachable API: start it with `pnpm dev:api`"
            else -> null
        }
    }

    /** Whether the app's configured API answers its health check from the device. */
    private fun apiAnswers(): Boolean = runBlocking { runCatching { TranApiClient().checkHealth() }.isSuccess }

    // Given

    private fun given(step: ContractStep) {
        when (step.verb) {
            "session" -> session = when (step.value) {
                // Android resolves the stored session synchronously: no session is signed out.
                "none", "unauthenticated" -> AuthSession.Unauthenticated
                "citizen_voter" -> AuthSession.Authenticated(userId = "voter-001", role = TranUserRole.CITIZEN_VOTER)
                "election_auditor" -> AuthSession.Authenticated(userId = "auditor-001", role = TranUserRole.ELECTION_AUDITOR)
                else -> throw AssertionError("${driver.place(step)}: unknown session")
            }
            "api_reachable" -> apiUnreachable = false
            "api_unreachable" -> apiUnreachable = true
            "locale" -> localeTag = step.value ?: localeTag
            "theme" -> theme = TranTheme.entries.firstOrNull { it.id == step.value }
                ?: throw AssertionError("${driver.place(step)}: unknown theme")
            "largest_text_scale" -> largestText = true
            // The debug launch extra's spelling, `location_approximate=denied_permanently` (spec 026).
            "permission" -> permissions = stagedPermission("${step.permission}=${step.value}")
                ?.let { (_, status) -> StagedPermissionGateway(status) }
                ?: throw AssertionError("${driver.place(step)}: unknown permission or status")
            else -> fail("${driver.place(step)}: unknown given")
        }
    }

    /**
     * Composes the app's coordinator in the scenario's given state, before the first `When` or
     * `Then`, so the givens can come in any order.
     */
    private fun launch() {
        if (launched) return
        launched = true
        // 127.0.0.1:1 refuses at once; the debug network config still allows loopback.
        val api = if (apiUnreachable) TranApiClient(baseUrl = "http://127.0.0.1:1") else TranApiClient()
        val fontScale = if (largestText) ScreenContract.Minimums.largestFontScale else null
        compose.setContent {
            val context = LocalContext.current
            val configuration = Configuration(LocalConfiguration.current).apply { setLocale(Locale.forLanguageTag(localeTag)) }
            val density = LocalDensity.current
            CompositionLocalProvider(
                LocalContext provides context.createConfigurationContext(configuration),
                LocalConfiguration provides configuration,
                LocalDensity provides Density(density.density, fontScale ?: density.fontScale),
            ) {
                NavigationCoordinator(initialTheme = theme, api = api, initialSession = session, permissions = permissions)
            }
        }
        record("given")
    }

    // When

    private fun whenStep(step: ContractStep) {
        launch()
        val id = step.id ?: return fail("${driver.place(step)}: unknown step")
        val node = driver.find(id, step)
        driver.assertMinimum(node, id, step)
        when (step.verb) {
            "tap" -> node.performClick()
            // `type` replaces the field's content, as on the web.
            "type" -> node.performTextReplacement(step.text.orEmpty())
            "select" -> {
                val option = step.option.orEmpty()
                val where = "${driver.place(step, id)} › option \"$option\""
                val choice = driver.option(id, option, step)
                driver.assertMinimum(choice, driver.declared(id, step).touch, where)
                choice.performClick()
                driver.eventually("$where: not selected after the tap") {
                    driver.nodes(optionTag(id, option))
                        .firstOrNull()?.config?.getOrNull(SemanticsProperties.Selected) == true
                }
            }
            "press_key" -> if (step.key == "Enter") node.performImeAction() else fail("${driver.place(step, id)}: only Enter has an IME action")
            else -> fail("${driver.place(step, id)}: unknown when")
        }
        record(step.title)
    }

    // Then

    private fun thenStep(step: ContractStep) {
        launch()
        if (largestText && !checkedReach) {
            checkedReach = true
            driver.assertReachable(step)
        }
        val id = step.id ?: return fail("${driver.place(step)}: unknown step")
        val where = driver.place(step, id)
        when (step.verb) {
            "exists" -> driver.assertMinimum(driver.find(id, step), id, step)
            "missing" -> driver.eventually("$where: still present") { driver.nodes(id).isEmpty() }
            "text_is", "announced" -> {
                if (step.verb == "announced") assertEquals("$where: only a live region announces", "live_region", driver.declared(id, step).kind)
                val expected = ContractStrings.resolve(step.key.orEmpty(), step.args, localeTag)
                val node = driver.find(id, step)
                driver.eventually("$where: reads \"${driver.text(id)}\", expected \"$expected\"") { driver.text(id) == expected }
                driver.assertLive(node, id, step)
            }
            "has_focus" -> {
                driver.eventually("$where: does not have focus") {
                    driver.nodes(id).firstOrNull()?.config?.getOrNull(SemanticsProperties.Focused) == true
                }
                driver.find(id, step).assertIsFocused()
            }
            "count" -> driver.assertCount(id, step.n ?: 0, step)
            else -> fail("$where: unknown then")
        }
    }
}
