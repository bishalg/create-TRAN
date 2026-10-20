package com.tran.voting.ui.atoms

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import com.tran.voting.generated.TranRadius
import com.tran.voting.generated.TranSpace

/**
 * Persistent, non-blocking notice for a condition that is still true — the API is unreachable —
 * removed by its owner when the condition clears (REQ-ERR-006). Never auto-dismisses.
 */
@Composable
fun TranBanner(message: String, modifier: Modifier = Modifier) {
    val palette = LocalTranPalette.current
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(TranRadius.sm),
        color = palette.surface,
        border = BorderStroke(TranSpace.xxs, palette.accent),
    ) {
        Row(Modifier.padding(TranSpace.base)) {
            Text(
                text = "!",
                color = palette.accent,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(end = TranSpace.sm).clearAndSetSemantics {},
            )
            Text(message, color = palette.textPrimary)
        }
    }
}
