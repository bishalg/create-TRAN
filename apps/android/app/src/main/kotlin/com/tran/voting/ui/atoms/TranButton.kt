package com.tran.voting.ui.atoms

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import com.tran.voting.generated.TranSpace

enum class TranButtonVariant { PRIMARY, SECONDARY }

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
) {
    val contentPadding = PaddingValues(horizontal = size.horizontalPadding, vertical = TranSpace.sm)
    when (variant) {
        TranButtonVariant.PRIMARY -> Button(
            onClick = onClick,
            modifier = modifier,
            contentPadding = contentPadding,
        ) {
            Text(label)
        }
        TranButtonVariant.SECONDARY -> OutlinedButton(
            onClick = onClick,
            modifier = modifier,
            contentPadding = contentPadding,
        ) {
            Text(label)
        }
    }
}
