package com.tran.voting.ui.atoms

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight

/** Typography and tone variants — the same vocabulary as the web `TranText` atom. */
enum class TranTextVariant { DISPLAY, TITLE, BODY, CAPTION, MUTED, SUCCESS, DANGER }

/**
 * Token-bound typography atom. Styles are Material's semantic type ramp so font scaling keeps
 * working (REQ-NAT-004); colours come from the palette. `live` marks a region whose changes are
 * announced (REQ-NAT-003). `label` names changing content for TalkBack, which reads a description
 * instead of the text: "Result, <verdict>", as the screen contract declares it (REQ-SCR-008).
 */
@Composable
fun TranText(
    text: String,
    modifier: Modifier = Modifier,
    variant: TranTextVariant = TranTextVariant.BODY,
    bold: Boolean = false,
    live: Boolean = false,
    label: String? = null,
) {
    val palette = LocalTranPalette.current
    val base: TextStyle = when (variant) {
        TranTextVariant.DISPLAY -> MaterialTheme.typography.headlineLarge
        TranTextVariant.TITLE -> MaterialTheme.typography.titleLarge
        TranTextVariant.CAPTION -> MaterialTheme.typography.bodySmall
        else -> MaterialTheme.typography.bodyLarge
    }
    val color: Color = when (variant) {
        TranTextVariant.MUTED -> palette.textPrimary.copy(alpha = 0.8f)
        TranTextVariant.SUCCESS -> palette.success
        TranTextVariant.DANGER -> palette.danger
        else -> palette.textPrimary
    }
    Text(
        text = text,
        modifier = modifier.semantics {
            if (live) liveRegion = LiveRegionMode.Polite
            // A pause, not copy: TalkBack reads "Result, <verdict>".
            if (label != null) contentDescription = listOf(label, text).joinToString(", ")
        },
        style = if (bold) base.copy(fontWeight = FontWeight.Bold) else base,
        color = color,
    )
}
