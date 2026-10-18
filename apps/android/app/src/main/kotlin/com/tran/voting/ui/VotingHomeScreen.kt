package com.tran.voting.ui

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import com.tran.voting.generated.BrandPalette
import com.tran.voting.generated.TranBrandTokens
import uniffi.tran_uniffi.TranValidationException
import uniffi.tran_uniffi.evaluateVoteEligibilityOffline
import java.time.LocalDate

/** Voting demo — brand tokens + offline rust-core rules via UniFFI. */
@Composable
fun VotingHomeScreen() {
    var useDark by remember { mutableStateOf(true) }
    var ageText by remember { mutableStateOf("20") }
    var countryCode by remember { mutableStateOf("NP") }
    var resultText by remember { mutableStateOf("Tap Check offline") }
    val palette: BrandPalette = if (useDark) TranBrandTokens.Dark else TranBrandTokens.Light

    val view = LocalView.current
    LaunchedEffect(useDark) {
        val window = (view.context as Activity).window
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !useDark
            isAppearanceLightNavigationBars = !useDark
        }
    }

    MaterialTheme(
        colorScheme = if (useDark) {
            darkColorScheme(background = palette.background, primary = palette.primary)
        } else {
            lightColorScheme(background = palette.background, primary = palette.primary)
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(palette.background)
                .safeDrawingPadding()
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "TRAN / Android",
                style = MaterialTheme.typography.titleLarge,
                color = palette.textPrimary,
            )
            Text(
                text = "Offline voting (UniFFI → rust-core)",
                style = MaterialTheme.typography.bodyMedium,
                color = palette.textPrimary.copy(alpha = 0.8f),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = ageText,
                    onValueChange = { ageText = it },
                    label = { Text("Age") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = countryCode,
                    onValueChange = { countryCode = it.uppercase() },
                    label = { Text("Country") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
            }
            Button(
                onClick = {
                    resultText =
                        runOfflineCheck(ageText, countryCode, palette)
                },
            ) {
                Text("Check offline")
            }
            Text(
                text = resultText,
                style = MaterialTheme.typography.bodyLarge,
                color = palette.textPrimary,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Dark theme",
                    style = MaterialTheme.typography.bodyMedium,
                    color = palette.textPrimary,
                )
                Switch(checked = useDark, onCheckedChange = { useDark = it })
            }
        }
    }
}

private fun runOfflineCheck(
    ageText: String,
    countryCode: String,
    palette: BrandPalette,
): String {
    val age = ageText.toUShortOrNull() ?: return "Enter a valid age"
    if (countryCode.length != 2) return "Country must be two letters"
    val reference = LocalDate.now().toString()
    return try {
        val res = evaluateVoteEligibilityOffline(age, null, countryCode, reference)
        val _chip = if (res.eligible) palette.eligibilityCanVote else palette.eligibilityCannotVote
        res.reason
    } catch (e: TranValidationException.ValidationException) {
        e.detail
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
        style = MaterialTheme.typography.labelMedium,
        color = color,
    )
}
