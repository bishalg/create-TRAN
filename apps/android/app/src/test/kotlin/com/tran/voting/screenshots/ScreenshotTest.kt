package com.tran.voting.screenshots

import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.printToString
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import com.tran.voting.NavigationCoordinator
import com.tran.voting.api.TranApiClient
import com.tran.voting.generated.TranStrings
import com.tran.voting.generated.TranTheme
import kotlinx.coroutines.Dispatchers
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * Verifies: REQ-PERF-003
 *
 * The real app root in every registry theme × every locale, rendered on the JVM by Robolectric
 * with the Rust core loaded, compared by Roborazzi with this machine's references
 * (`app/.screenshots/`, gitignored; recorded on the first run — ADR-0031).
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class ScreenshotTest(private val theme: TranTheme, private val locale: String) {
    @get:Rule
    val compose = createComposeRule()

    private val name = "${theme.id}-$locale"

    /** Requests the fake API has answered — reported when a wait times out. */
    private val answered = AtomicInteger()

    private fun launch() {
        // `en` is the default `values/` folder; others are a locale qualifier.
        if (locale != "en") RuntimeEnvironment.setQualifiers("+$locale")
        compose.setContent { NavigationCoordinator(initialTheme = theme, api = healthyApi(answered)) }
        // The startup health check runs off the main thread: wait for its answer, not a timer.
        awaitNode(hasText(RuntimeEnvironment.getApplication().getString(TranStrings.Shell.statusOnline)))
    }

    /**
     * Waits for a node that appears after the (fake) API answers, stepping the Compose clock when
     * the test has frozen it. On timeout it reports what was on screen and how many requests the
     * fake API answered — "answered, but the screen never changed" points at threading.
     */
    private fun awaitNode(matcher: SemanticsMatcher) {
        try {
            compose.waitUntil(TIMEOUT_MS) {
                if (!compose.mainClock.autoAdvance) compose.mainClock.advanceTimeByFrame()
                compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()
            }
        } catch (timeout: ComposeTimeoutException) {
            // Say what was on screen instead: the missing node alone rarely explains a timeout.
            throw AssertionError(
                "$name: no node ${matcher.description} after ${TIMEOUT_MS}ms (fake API answered ${answered.get()} " +
                    "requests); screen:\n" +
                    compose.onRoot().printToString(),
                timeout,
            )
        }
    }

    /** Sign out through the confirmation dialog, landing on the welcome screen. */
    private fun signOut() {
        compose.onNodeWithTag("sign-out-button").performClick()
        compose.onNodeWithTag("dialog-confirm").performClick()
        awaitNode(hasTestTag("voter-branch-button"))
    }

    @Test
    fun home() {
        launch()
        compose.onRoot().captureRoboImage("home-$name.png")
    }

    @Test
    fun result() {
        launch()
        // The server confirmation ends in a toast that times out. A free-running test clock can
        // skip straight past that timeout, so freeze it: step to the toast, then a fixed settle
        // well inside its shortest duration.
        compose.mainClock.autoAdvance = false
        compose.onNodeWithTag("check-button").performClick()
        awaitNode(hasTestTag("toast"))
        compose.mainClock.advanceTimeBy(SETTLE_MS)
        compose.onRoot().captureRoboImage("result-$name.png")
    }

    @Test
    fun signOutDialog() {
        launch()
        compose.onNodeWithTag("sign-out-button").performClick()
        compose.waitForIdle()
        // The dialog is its own window, so capture the whole screen.
        captureScreenRoboImage("sign-out-dialog-$name.png")
    }

    @Test
    fun welcome() {
        launch()
        signOut()
        compose.onRoot().captureRoboImage("welcome-$name.png")
    }

    @Test
    fun auditor() {
        launch()
        signOut()
        compose.onNodeWithTag("auditor-branch-button").performClick()
        compose.waitForIdle()
        compose.onRoot().captureRoboImage("auditor-$name.png")
    }

    companion object {
        // Wall-clock: generous so a loaded machine is not a failure; a broken screen still fails.
        private const val TIMEOUT_MS = 15_000L
        private const val SETTLE_MS = 500L

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun matrix(): List<Array<Any>> =
            TranTheme.entries.flatMap { theme -> locales().map { arrayOf<Any>(theme, it) } }

        /** The locale folders under `locales/` — the same list every platform ships. */
        private fun locales(): List<String> =
            File(repoRoot(), "locales").listFiles { file -> file.isDirectory }!!
                .map { it.name }
                .sorted()

        private fun repoRoot(): String =
            System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set (the Gradle test task sets it)")

        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() {
            val libDir = System.getenv("UNIFFI_LIB_DIR") ?: File(repoRoot(), "target/release").path
            System.setProperty("jna.library.path", libDir)
        }

        /**
         * Answers every request with an empty 200, at once — the status pill shows "online". The
         * call stays on the calling thread (`Unconfined`): a hop to `Dispatchers.IO` and back to
         * Robolectric's main thread lost about one resume in fifty, leaving "Checking API…".
         */
        private fun healthyApi(answered: AtomicInteger) =
            TranApiClient(
                baseUrl = "http://api.test",
                includeDebugCountry = false,
                http = OkHttpClient.Builder()
                    .addInterceptor { chain ->
                        answered.incrementAndGet()
                        Response.Builder()
                            .request(chain.request())
                            .protocol(Protocol.HTTP_1_1)
                            .code(200)
                            .message("OK")
                            .body("{}".toResponseBody("application/json".toMediaType()))
                            .build()
                    }
                    .build(),
                io = Dispatchers.Unconfined,
            )
    }
}
