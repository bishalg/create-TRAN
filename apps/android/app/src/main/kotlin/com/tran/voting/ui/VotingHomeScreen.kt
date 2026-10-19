package com.tran.voting.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import com.tran.voting.generated.BrandPalette
import com.tran.voting.generated.TranStrings
import com.tran.voting.generated.TranTheme
import com.tran.voting.generated.labelRes
import uniffi.tran_uniffi.TranValidationException
import uniffi.tran_uniffi.evaluateVoteEligibilityOffline
import android.content.Context
import java.time.LocalDate

/** Voting demo — brand tokens + offline rust-core rules via UniFFI. Copy comes from the shared dictionaries through generated `TranStrings` accessors. */
@Composable
fun VotingHomeScreen(
    palette: BrandPalette,
    theme: TranTheme,
    onThemeChange: (TranTheme) -> Unit,
    onSignOut: (() -> Unit)? = null
) {
    var ageText by remember { mutableStateOf("20") }
    var countryCode by remember { mutableStateOf("NP") }
    val resultPlaceholder = stringResource(TranStrings.Eligibility.resultPlaceholder)
    var resultText by remember { mutableStateOf(resultPlaceholder) }
    val invalidAge = stringResource(TranStrings.Errors.ageInvalid)
    val ageOutOfRange = stringResource(TranStrings.Errors.ageOutOfRange)
    val invalidCountry = stringResource(TranStrings.Errors.countryInvalid)
    val context = LocalContext.current

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
                    text = stringResource(TranStrings.Shell.header, "Android"),
                    style = MaterialTheme.typography.titleLarge,
                    color = palette.textPrimary,
                )
                Text(
                    text = stringResource(TranStrings.Eligibility.subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = palette.textPrimary.copy(alpha = 0.8f),
                )
            }
            if (onSignOut != null) {
                Button(
                    modifier = Modifier.testTag("sign-out-button"),
                    onClick = onSignOut
                ) {
                    Text(stringResource(TranStrings.Common.signOut))
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = ageText,
                onValueChange = { ageText = it },
                label = { Text(stringResource(TranStrings.Eligibility.ageLabel)) },
                singleLine = true,
                modifier = Modifier.weight(1f).testTag("age-field"),
            )
            OutlinedTextField(
                value = countryCode,
                onValueChange = { countryCode = it.uppercase() },
                label = { Text(stringResource(TranStrings.Eligibility.countryLabel)) },
                singleLine = true,
                modifier = Modifier.weight(1f).testTag("country-field"),
            )
        }
        Button(
            modifier = Modifier.testTag("check-button"),
            onClick = {
                resultText = runOfflineCheck(context, ageText, countryCode, invalidAge, ageOutOfRange, invalidCountry)
            },
        ) {
            Text(stringResource(TranStrings.Eligibility.checkOffline))
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
        // `pnpm tokens:sync`, with its label from the shared dictionaries (`shell.theme.*`).
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

private const val MAX_AGE = 150

/** Every message shown comes from string resources; the core's English `reason`/`detail` is never displayed. */
private fun runOfflineCheck(
    context: Context,
    ageText: String,
    countryCode: String,
    invalidAge: String,
    ageOutOfRange: String,
    invalidCountry: String,
): String {
    val age = ageText.toUShortOrNull() ?: return invalidAge
    if (age.toInt() > MAX_AGE) return ageOutOfRange
    if (countryCode.length != 2 || !countryCode.all { it.isLetter() }) return invalidCountry
    val reference = LocalDate.now().toString()
    return try {
        val result = evaluateVoteEligibilityOffline(age, null, countryCode, reference)
        context.getString(
            if (result.eligible) TranStrings.Eligibility.resultReasonMeets else TranStrings.Eligibility.resultReasonBelow,
            result.age.toString(),
            result.minimumAge.toString(),
            result.countryCode,
        )
    } catch (e: TranValidationException.ValidationException) {
        invalidCountry
    }
}
