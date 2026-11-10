package com.tran.voting.ui

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The Android half of the conformance manifest (ADR-0038 decision 6, REQ-SCR-008): after a
 * scenario's given state, each `When` and its last `Then`, `ScreenContractTest` records the merged
 * semantics tree TalkBack reads, and `pnpm screens:check` compares it with the contract.
 *
 * The manifest goes to the instrumentation's `additionalTestOutputDir`, which the Android Gradle
 * plugin pulls into `app/build/outputs/connected_android_test_additional_output/` after the run;
 * `pnpm android:test` copies it to `e2e/conformance/android.json` (`e2e/conformance/README.md`).
 * The whole manifest is rewritten after every snapshot, so an interrupted run still leaves one.
 */
object ConformanceManifest {
    private val snapshots = JSONArray()

    private val file: File by lazy {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val dir = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File)
            ?: instrumentation.targetContext.getExternalFilesDir(null)
            ?: instrumentation.targetContext.filesDir
        File(dir, "android.json")
    }

    /** Records the composition's tree after `phase`, unless it is what this scenario recorded last. */
    fun record(compose: ComposeContentTestRule, scenario: String, phase: String, locale: String) {
        compose.waitForIdle()
        val density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density
        val elements = JSONArray()
        // Every root: the activity's and one per dialog window.
        compose.onAllNodes(isRoot()).fetchSemanticsNodes().forEach { collect(it, null, density, elements) }
        val last = if (snapshots.length() > 0) snapshots.getJSONObject(snapshots.length() - 1) else null
        if (last?.getString("scenario") == scenario && last.getJSONArray("elements").toString() == elements.toString()) return
        snapshots.put(
            JSONObject()
                .put("platform", "android")
                .put("scenario", scenario)
                .put("phase", phase)
                .put("locale", locale)
                .put("elements", elements),
        )
        file.parentFile?.mkdirs()
        file.writeText(JSONObject().put("platform", "android").put("snapshots", snapshots).toString(1))
    }

    private fun collect(node: SemanticsNode, within: String?, density: Float, elements: JSONArray) {
        val config = node.config
        val id = config.getOrNull(SemanticsProperties.TestTag)
        val actions = buildList {
            if (SemanticsActions.OnClick in config) add("OnClick")
            if (SemanticsActions.SetText in config) add("SetText")
        }
        val interactive = actions.isNotEmpty()
        if (id != null || interactive) {
            val description = config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ").orEmpty()
            val text = config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty()
            val editable = config.getOrNull(SemanticsProperties.EditableText)?.text
            // TalkBack reads the description when there is one, else the text; a field's text is its value.
            val name = description.ifEmpty { text }
            val value = editable ?: if (description.isNotEmpty()) text else ""
            val bounds = touchFrame(node, interactive, density)
            val element = JSONObject()
                .put("role", role(node))
                .put("name", name)
                .put("interactive", interactive)
                .put(
                    "frame",
                    JSONObject()
                        .put("x", (bounds.left / density).toDouble())
                        .put("y", (bounds.top / density).toDouble())
                        .put("width", (bounds.width / density).toDouble())
                        .put("height", (bounds.height / density).toDouble()),
                )
                .put("unit", "dp")
            if (id != null) element.put("id", id)
            if (value.isNotEmpty() && value != name) element.put("value", value)
            if (actions.isNotEmpty()) element.put("actions", JSONArray(actions))
            config.getOrNull(SemanticsProperties.LiveRegion)?.let { element.put("live", it.toString()) }
            if (within != null) element.put("within", within)
            elements.put(element)
        }
        node.children.forEach { collect(it, id ?: within, density, elements) }
    }

    /**
     * The node's touch bounds, as XCUITest and Chromium report a frame: a node scrolled partly or
     * wholly out of the viewport keeps its size. `touchBoundsInRoot` is clipped by the scroll
     * container, so a control straddling the screen's edge would read as too small (or 0×0) although
     * it is not; for such a node the frame is rebuilt from its position and size, with the padding
     * Compose adds to reach the minimum touch target. A node that is not clipped is recorded as is.
     */
    private fun touchFrame(node: SemanticsNode, interactive: Boolean, density: Float): Rect {
        val clipped = node.touchBoundsInRoot
        val position = node.positionInRoot
        val minimum = if (interactive) MINIMUM_TOUCH_DP * density else 0f
        val padX = ((minimum - node.size.width) / 2).coerceAtLeast(0f)
        val padY = ((minimum - node.size.height) / 2).coerceAtLeast(0f)
        val unclipped = Rect(position.x - padX, position.y - padY, position.x + node.size.width + padX, position.y + node.size.height + padY)
        val whole = clipped.width + 1f >= unclipped.width && clipped.height + 1f >= unclipped.height
        return if (whole) clipped else unclipped
    }

    /** Compose's default `ViewConfiguration.minimumTouchTargetSize`. */
    private const val MINIMUM_TOUCH_DP = 48f

    /** The node's `Role` when it declares one, else what its semantics make it. */
    private fun role(node: SemanticsNode): String {
        val config = node.config
        config.getOrNull(SemanticsProperties.Role)?.let { return it.toString() }
        return when {
            SemanticsActions.SetText in config -> "TextField"
            config.getOrNull(SemanticsProperties.ProgressBarRangeInfo) != null -> "ProgressBar"
            SemanticsProperties.Text in config -> "Text"
            else -> "None"
        }
    }
}
