package com.tran.voting.ui.atoms

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.unit.Dp
import com.tran.voting.generated.TranSpace

/**
 * The web `TranButton` variants. `DANGER` marks an action that destroys data (deleting the
 * account): the palette's danger colour on the border and a tint of it behind the label, which
 * keeps the primary text colour so its contrast is the screen's own.
 */
enum class TranButtonVariant { PRIMARY, SECONDARY, DANGER }

enum class TranButtonSize(val horizontalPadding: Dp) {
    MD(TranSpace.md),
    LG(TranSpace.lg),
}

/**
 * Token-sized action button. Material3 enforces the 48 dp touch floor on every button, so the
 * minimum target lives here rather than in feature code (REQ-NAT-005); colours come from the
 * Material scheme derived from the palette (REQ-NAT-009).
 */
@Composable
fun TranButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: TranButtonVariant = TranButtonVariant.PRIMARY,
    size: TranButtonSize = TranButtonSize.LG,
    /** `false` shows Material's disabled treatment and ignores taps (e.g. while a request is in flight). */
    enabled: Boolean = true,
) {
    val contentPadding = PaddingValues(horizontal = size.horizontalPadding, vertical = TranSpace.sm)
    when (variant) {
        TranButtonVariant.PRIMARY -> Button(
            onClick = onClick,
            modifier = modifier,
            enabled = enabled,
            contentPadding = contentPadding,
        ) {
            Text(label)
        }
        TranButtonVariant.SECONDARY -> OutlinedButton(
            onClick = onClick,
            modifier = modifier,
            enabled = enabled,
            contentPadding = contentPadding,
        ) {
            Text(label)
        }
        TranButtonVariant.DANGER -> {
            val palette = LocalTranPalette.current
            OutlinedButton(
                onClick = onClick,
                modifier = modifier,
                enabled = enabled,
                contentPadding = contentPadding,
                border = BorderStroke(ButtonDefaults.outlinedButtonBorder(enabled = true).width, palette.danger),
                colors = ButtonDefaults.outlinedButtonColors(
                    containerColor = palette.danger.copy(alpha = DANGER_TINT).compositeOver(palette.background),
                    contentColor = palette.textPrimary,
                ),
            ) {
                Text(label)
            }
        }
    }
}

/** The web's `color-mix(danger 16%)` behind a danger button's label. */
private const val DANGER_TINT = 0.16f
