package com.tran.voting.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import com.tran.voting.R
import com.tran.voting.generated.BrandPalette
import com.tran.voting.generated.TranTheme
import com.tran.voting.generated.labelRes
import uniffi.tran_uniffi.TranValidationException
import uniffi.tran_uniffi.evaluateVoteEligibilityOffline
import java.time.LocalDate

/** Voting demo — brand tokens + offline rust-core rules via UniFFI. Copy comes from generated `strings.xml`. */
@Composable
fun VotingHomeScreen(
    palette: BrandPalette,
    theme: TranTheme,
    onThemeChange: (TranTheme) -> Unit,
    onSignOut: (() -> Unit)? = null
) {
    var ageText by remember { mutableStateOf("20") }
    var countryCode by remember { mutableStateOf("NP") }
    val resultPlaceholder = stringResource(R.string.native_result_placeholder)
    var resultText by remember { mutableStateOf(resultPlaceholder) }
    val invalidAge = stringResource(R.string.native_invalid_age)
    val invalidCountry = stringResource(R.string.native_invalid_country)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background)
            .safeDrawingPadding()
            .semantics { testTagsAsResourceId = true }
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = stringResource(R.string.native_android_header),
                    style = MaterialTheme.typography.titleLarge,
                    color = palette.textPrimary,
                )
                Text(
                    text = stringResource(R.string.native_voter_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = palette.textPrimary.copy(alpha = 0.8f),
                )
            }
            if (onSignOut != null) {
                Button(
                    modifier = Modifier.testTag("sign-out-button"),
                    onClick = onSignOut
                ) {
                    Text(stringResource(R.string.native_sign_out))
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = ageText,
                onValueChange = { ageText = it },
                label = { Text(stringResource(R.string.native_age_label)) },
                singleLine = true,
                modifier = Modifier.weight(1f).testTag("age-field"),
            )
            OutlinedTextField(
                value = countryCode,
                onValueChange = { countryCode = it.uppercase() },
                label = { Text(stringResource(R.string.native_country_label)) },
                singleLine = true,
                modifier = Modifier.weight(1f).testTag("country-field"),
            )
        }
        Button(
            modifier = Modifier.testTag("check-button"),
            onClick = {
                resultText =
                    runOfflineCheck(ageText, countryCode, palette, invalidAge, invalidCountry)
            },
        ) {
            Text(stringResource(R.string.native_check_offline))
        }
        Text(
            text = resultText,
            modifier = Modifier
                .testTag("offline-result")
                .semantics { liveRegion = LiveRegionMode.Polite },
            style = MaterialTheme.typography.bodyLarge,
            color = palette.textPrimary,
        )
        // Theme choices come from the rust-core registry: every palette renders here after
        // `pnpm tokens:sync`, with its label from the shared dictionaries (`app.themes.*`).
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .testTag("theme-picker"),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TranTheme.entries.forEach { mode ->
                FilterChip(
                    selected = mode == theme,
                    onClick = { onThemeChange(mode) },
                    label = { Text(stringResource(mode.labelRes)) },
                )
            }
        }
    }
}

private fun runOfflineCheck(
    ageText: String,
    countryCode: String,
    palette: BrandPalette,
    invalidAge: String,
    invalidCountry: String,
): String {
    val age = ageText.toUShortOrNull() ?: return invalidAge
    if (countryCode.length != 2) return invalidCountry
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
