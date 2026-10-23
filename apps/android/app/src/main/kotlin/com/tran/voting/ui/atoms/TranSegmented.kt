package com.tran.voting.ui.atoms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Single-choice segmented control. Android keeps Material3's chips — they already carry the
 * selected semantics and the platform's 48 dp touch floor (REQ-NAT-003, REQ-NAT-005) — with
 * labels from the caller so copy stays in the shared dictionaries (REQ-NAT-008). Chips wrap to the
 * next line instead of squeezing their labels on a narrow screen (REQ-NAT-013).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <T> TranSegmented(
    options: List<T>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    label: @Composable (T) -> String,
) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(TranGap.SM.value),
    ) {
        options.forEach { option ->
            FilterChip(
                selected = option == selected,
                onClick = { onSelect(option) },
                label = { Text(label(option)) },
            )
        }
    }
}
