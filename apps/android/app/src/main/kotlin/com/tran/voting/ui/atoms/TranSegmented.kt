package com.tran.voting.ui.atoms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

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
    // Names the control and each option for UI tests: the control's own id plus the option, so a
    // screen contract `select` step finds it (ADR-0038). `null` leaves them unnamed.
    testTag: String? = null,
    optionName: (T) -> String = { it.toString() },
    label: @Composable (T) -> String,
) {
    FlowRow(
        modifier = if (testTag == null) modifier else modifier.testTag(testTag),
        horizontalArrangement = Arrangement.spacedBy(TranGap.SM.value),
    ) {
        options.forEach { option ->
            FilterChip(
                selected = option == selected,
                onClick = { onSelect(option) },
                label = { Text(label(option)) },
                modifier = if (testTag == null) Modifier else Modifier.testTag(optionTag(testTag, optionName(option))),
            )
        }
    }
}

/**
 * `<control id>-<option>`: how a segmented control's option is addressed (the screen contract's
 * theme picker comment in `crates/rust-core/src/screens/catalogue.rs`).
 */
fun optionTag(control: String, option: String): String = "$control-$option"
