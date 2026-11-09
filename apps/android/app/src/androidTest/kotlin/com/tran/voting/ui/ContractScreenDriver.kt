package com.tran.voting.ui

import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import com.tran.voting.generated.ScreenContract
import com.tran.voting.ui.atoms.optionTag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail

/**
 * Finds the screen contract's elements in the composition and checks what their declaration
 * promises (REQ-SCR-006, REQ-SCR-007). Elements are found by their contract id (`testTag`); the
 * numbers come from the generated `ScreenContract.Minimums`.
 */
class ContractScreenDriver(
    private val compose: ComposeContentTestRule,
    private val screen: ContractScreen,
    private val scenario: ContractScenario,
) {
    private val density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density

    /** "scenario › step › element", so a failure says where it is. */
    fun place(step: ContractStep, id: String? = null): String =
        "${scenario.name} › ${step.title}" + (id?.let { " › element \"$it\"" } ?: "")

    fun declared(id: String, step: ContractStep): ContractElement =
        ScreenCatalogue.shared.element(id) ?: throw AssertionError("${place(step, id)}: not an element of the screen contract")

    fun nodes(id: String): List<SemanticsNode> = compose.onAllNodesWithTag(id).fetchSemanticsNodes()

    /** Waits up to the scenario's bound for `condition`, failing with `message`. */
    fun eventually(message: String, condition: () -> Boolean) {
        try {
            compose.waitUntil(scenario.withinMs) { condition() }
        } catch (timeout: ComposeTimeoutException) {
            fail("$message (within ${scenario.withinMs} ms)")
        }
    }

    /** The element `id`, once it exists, scrolled into view and displayed. */
    fun find(id: String, step: ContractStep): SemanticsNodeInteraction {
        eventually("${place(step, id)}: does not exist") { nodes(id).isNotEmpty() }
        return compose.onNodeWithTag(id).also(::scrollTo).assertIsDisplayed()
    }

    /** `<control id>-<option>`, as `TranSegmented` tags each option. */
    fun option(id: String, option: String, step: ContractStep): SemanticsNodeInteraction {
        val tag = optionTag(id, option)
        eventually("${place(step, id)} › option \"$option\": no such option") { nodes(tag).isNotEmpty() }
        return compose.onNodeWithTag(tag).also(::scrollTo)
    }

    /** Only an element inside a scrolling container can be scrolled to; the others are in view. */
    private fun scrollTo(node: SemanticsNodeInteraction) {
        if (hasAnyAncestor(SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)).matches(node.fetchSemanticsNode())) {
            node.performScrollTo()
        }
    }

    /** What a node reads: a field's text, or its text runs joined. */
    fun text(id: String): String? = nodes(id).firstOrNull()?.let { node ->
        node.config.getOrNull(SemanticsProperties.EditableText)?.text
            ?: node.config.getOrNull(SemanticsProperties.Text)?.joinToString("") { it.text }
    }

    // Non-functional rules (REQ-SCR-007)

    /** A `control` or `primary` element meets the Android minimum on both axes, in touch bounds. */
    fun assertMinimum(node: SemanticsNodeInteraction, touch: String, where: String) {
        if (touch == "none") return
        val minimum = if (touch == "primary") ScreenContract.Minimums.primaryAction else ScreenContract.Minimums.control
        val bounds = node.fetchSemanticsNode().touchBoundsInRoot
        val width = bounds.width / density
        val height = bounds.height / density
        assertTrue("$where: touch target is ${width}×${height} dp, below the $touch minimum of $minimum dp", width >= minimum && height >= minimum)
    }

    fun assertMinimum(node: SemanticsNodeInteraction, id: String, step: ContractStep) =
        assertMinimum(node, declared(id, step).touch, place(step, id))

    /** A `live_region` is announced politely, the mechanism `TranText(live = true)` uses (REQ-NAT-003). */
    fun assertLive(node: SemanticsNodeInteraction, id: String, step: ContractStep) {
        if (declared(id, step).kind != "live_region") return
        try {
            node.assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
        } catch (error: AssertionError) {
            fail("${place(step, id)}: not a polite live region")
        }
    }

    /**
     * At the largest font scale every always-present element of the screen can be scrolled to, is
     * displayed wholly inside the screen's width and keeps its touch size; a segmented control's
     * every option too (REQ-NAT-004, REQ-NAT-013).
     */
    fun assertReachable(step: ContractStep) {
        val width = compose.onAllNodes(isRoot()).onFirst().fetchSemanticsNode().size.width
        for (element in screen.elements.filter { it.always }) {
            val where = place(step, element.id)
            val node = find(element.id, step)
            assertInside(node, width, where)
            assertMinimum(node, element.touch, where)
            if (element.kind == "segmented") {
                val options = compose.onAllNodes(hasAnyAncestor(hasTestTag(element.id)) and hasClickAction())
                val count = options.fetchSemanticsNodes().size
                assertTrue("$where: no options", count > 0)
                for (index in 0 until count) {
                    val option = options[index]
                    assertInside(option, width, "$where › option $index")
                    assertMinimum(option, element.touch, "$where › option $index")
                }
            }
        }
    }

    private fun assertInside(node: SemanticsNodeInteraction, width: Int, where: String) {
        val bounds = node.fetchSemanticsNode().boundsInRoot
        assertTrue("$where: starts off screen at ${bounds.left}", bounds.left >= 0f)
        assertTrue("$where: ends off screen at ${bounds.right} of $width", bounds.right <= width)
    }

    fun assertCount(id: String, n: Int, step: ContractStep) {
        eventually("${place(step, id)}: ${nodes(id).size} found, expected $n") { nodes(id).size == n }
        assertEquals(place(step, id), n, nodes(id).size)
    }
}
