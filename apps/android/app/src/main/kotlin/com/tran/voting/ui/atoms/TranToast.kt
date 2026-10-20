package com.tran.voting.ui.atoms

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import com.tran.voting.generated.TranRadius
import com.tran.voting.generated.TranSpace
import uniffi.tran_uniffi.TranToastTone

/**
 * Non-blocking, self-dismissing message (REQ-ERR-006) — the web `TranToast` atom. The owner times
 * it out with the catalogue duration; it is a polite live region so it is announced without
 * taking focus, and the dismiss button keeps Material's 48 dp target (REQ-NAT-005).
 */
@Composable
fun TranToast(
    tone: TranToastTone,
    message: String,
    dismissLabel: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    reference: String? = null,
) {
    val palette = LocalTranPalette.current
    val toneColor: Color = when (tone) {
        TranToastTone.SUCCESS -> palette.success
        TranToastTone.INFO -> palette.primary
        TranToastTone.WARNING -> palette.accent
        TranToastTone.ERROR -> palette.danger
    }
    val icon = when (tone) {
        TranToastTone.SUCCESS -> Icons.Filled.CheckCircle
        TranToastTone.INFO -> Icons.Filled.Info
        TranToastTone.WARNING, TranToastTone.ERROR -> Icons.Filled.Warning
    }
    Surface(
        modifier = modifier.fillMaxWidth().testTag("toast").semantics { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(TranRadius.md),
        color = palette.surface,
        border = BorderStroke(TranSpace.xxs, toneColor),
    ) {
        Row(
            modifier = Modifier.padding(start = TranSpace.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = toneColor)
            Column(Modifier.weight(1f).padding(horizontal = TranSpace.sm, vertical = TranSpace.sm)) {
                Text(message, color = palette.textPrimary, fontWeight = FontWeight.SemiBold)
                if (reference != null) {
                    Text(reference, color = palette.textPrimary, style = MaterialTheme.typography.bodySmall)
                }
            }
            IconButton(onClick = onDismiss, modifier = Modifier.testTag("toast-dismiss")) {
                Icon(Icons.Filled.Close, contentDescription = dismissLabel, tint = palette.textPrimary)
            }
        }
    }
}
