package com.tran.voting.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.tran.voting.generated.TranBrandTokens

@Composable
fun VotingHomeScreen() {
    var useDark by remember { mutableStateOf(true) }
    val palette = if (useDark) TranBrandTokens.Dark else TranBrandTokens.Light

    MaterialTheme(
        colorScheme = MaterialTheme.colorScheme.copy(
            background = palette.background,
            primary = palette.primary,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(palette.background)
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("TRAN / Android", color = palette.textPrimary)
            Text(
                "Voting eligibility (native scaffold)",
                color = palette.textPrimary.copy(alpha = 0.8f),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                eligibilityChip("Eligible", palette.eligibilityCanVote)
                eligibilityChip("Not eligible", palette.eligibilityCannotVote)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Dark theme", color = palette.textPrimary)
                Switch(checked = useDark, onCheckedChange = { useDark = it })
            }
        }
    }
}

@Composable
private fun eligibilityChip(label: String, color: Color) {
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(color.copy(alpha = 0.2f))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = color,
    )
}
