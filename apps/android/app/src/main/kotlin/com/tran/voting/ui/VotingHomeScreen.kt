package com.tran.voting.ui

import android.content.Context
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.tran.voting.api.TranApiClient
import com.tran.voting.api.TranApiStatus
import com.tran.voting.api.tranApiStatusFrom
import com.tran.voting.generated.TranSpace
import com.tran.voting.generated.TranStrings
import com.tran.voting.generated.TranTheme
import com.tran.voting.generated.labelRes
import com.tran.voting.ui.atoms.TranButton
import com.tran.voting.ui.atoms.TranButtonSize
import com.tran.voting.ui.atoms.TranButtonVariant
import com.tran.voting.ui.atoms.TranField
import com.tran.voting.ui.atoms.TranGap
import com.tran.voting.ui.atoms.TranInline
import com.tran.voting.ui.atoms.TranScreen
import com.tran.voting.ui.atoms.TranSegmented
import com.tran.voting.ui.atoms.TranStack
import com.tran.voting.ui.atoms.TranText
import com.tran.voting.ui.atoms.TranTextVariant
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import uniffi.tran_uniffi.TranValidationException
import uniffi.tran_uniffi.evaluateVoteEligibilityOffline

/** Voting demo — brand tokens + offline rust-core rules via UniFFI. Copy comes from the shared dictionaries through generated `TranStrings` accessors. */
@Composable
fun VotingHomeScreen(
    theme: TranTheme,
    onThemeChange: (TranTheme) -> Unit,
    onSignOut: (() -> Unit)? = null,
    api: TranApiClient = TranApiClient(),
) {
    var ageText by remember { mutableStateOf("20") }
    var countryCode by remember { mutableStateOf("NP") }
    val resultPlaceholder = stringResource(TranStrings.Eligibility.resultPlaceholder)
    var resultText by remember { mutableStateOf(resultPlaceholder) }
    var apiStatus by remember { mutableStateOf(TranApiStatus.CHECKING) }
    val invalidAge = stringResource(TranStrings.Errors.ageInvalid)
    val ageOutOfRange = stringResource(TranStrings.Errors.ageOutOfRange)
    val invalidCountry = stringResource(TranStrings.Errors.countryInvalid)
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // REQ-NAT-011: the status pill mirrors the web footer; it never gates the device check.
    LaunchedEffect(Unit) {
        apiStatus = statusOf { api.checkHealth() }
    }

    TranScreen(
        modifier = Modifier
            .verticalScroll(rememberScrollState())
            .padding(TranSpace.lg),
    ) {
        TranStack(gap = TranGap.MD) {
            TranInline(gap = TranGap.MD, modifier = Modifier.fillMaxWidth()) {
                TranStack(gap = TranGap.XS) {
                    TranText(
                        text = stringResource(TranStrings.Shell.header, "Android"),
                        variant = TranTextVariant.TITLE,
                    )
                    TranText(
                        text = stringResource(TranStrings.Eligibility.subtitle),
                        variant = TranTextVariant.MUTED,
                    )
                }
                Spacer(Modifier.weight(1f))
                if (onSignOut != null) {
                    TranButton(
                        label = stringResource(TranStrings.Common.signOut),
                        onClick = onSignOut,
                        variant = TranButtonVariant.SECONDARY,
                        size = TranButtonSize.MD,
                        modifier = Modifier.testTag("sign-out-button"),
                    )
                }
            }
            TranInline(gap = TranGap.SM, modifier = Modifier.fillMaxWidth()) {
                TranField(
                    label = stringResource(TranStrings.Eligibility.ageLabel),
                    value = ageText,
                    onValueChange = { ageText = it },
                    modifier = Modifier.weight(1f).testTag("age-field"),
                )
                TranField(
                    label = stringResource(TranStrings.Eligibility.countryLabel),
                    value = countryCode,
                    onValueChange = { countryCode = it.uppercase() },
                    modifier = Modifier.weight(1f).testTag("country-field"),
                )
            }
            TranButton(
                label = stringResource(TranStrings.Eligibility.checkOffline),
                onClick = {
                    val check = runOfflineCheck(context, ageText, countryCode, invalidAge, ageOutOfRange, invalidCountry)
                    resultText = check.text
                    // REQ-NAT-011: the verdict is already on screen; the API call only moves the status pill.
                    check.age?.let { age ->
                        scope.launch {
                            apiStatus = statusOf { api.confirmEligibility(age, countryCode) }
                        }
                    }
                },
                modifier = Modifier.testTag("check-button"),
            )
            TranText(
                text = resultText,
                modifier = Modifier.testTag("offline-result"),
                live = true,
            )
            // Theme choices come from the rust-core registry: every palette renders here after
            // `pnpm tokens:sync`, with its label from the shared dictionaries (`shell.theme.*`).
            TranSegmented(
                options = TranTheme.entries,
                selected = theme,
                onSelect = onThemeChange,
                modifier = Modifier.fillMaxWidth().testTag("theme-picker"),
            ) { mode ->
                stringResource(mode.labelRes)
            }
            TranText(
                text = stringResource(
                    when (apiStatus) {
                        TranApiStatus.CHECKING -> TranStrings.Shell.statusChecking
                        TranApiStatus.ONLINE -> TranStrings.Shell.statusOnline
                        TranApiStatus.OFFLINE -> TranStrings.Shell.statusOffline
                    },
                ),
                variant = TranTextVariant.CAPTION,
                live = true,
                modifier = Modifier.testTag("api-status"),
            )
            if (apiStatus == TranApiStatus.OFFLINE) {
                TranText(
                    text = stringResource(TranStrings.Eligibility.offlineNotice),
                    variant = TranTextVariant.CAPTION,
                    modifier = Modifier.testTag("offline-notice"),
                )
            }
        }
    }
}

private const val MAX_AGE = 150

/** The verdict text plus the validated age, when the input was good enough for the API call. */
private data class OfflineCheck(val text: String, val age: Int?)

/** Maps a call outcome to the pill; unknown failures read as offline instead of crashing the dashboard. */
private suspend fun statusOf(block: suspend () -> Unit): TranApiStatus = try {
    block()
    TranApiStatus.ONLINE
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (error: Exception) {
    tranApiStatusFrom(error)
}

/** Every message shown comes from string resources; the core's English `reason`/`detail` is never displayed. */
private fun runOfflineCheck(
    context: Context,
    ageText: String,
    countryCode: String,
    invalidAge: String,
    ageOutOfRange: String,
    invalidCountry: String,
): OfflineCheck {
    val age = ageText.toUShortOrNull() ?: return OfflineCheck(invalidAge, null)
    if (age.toInt() > MAX_AGE) return OfflineCheck(ageOutOfRange, null)
    if (countryCode.length != 2 || !countryCode.all { it.isLetter() }) return OfflineCheck(invalidCountry, null)
    val reference = LocalDate.now().toString()
    return try {
        val result = evaluateVoteEligibilityOffline(age, null, countryCode, reference)
        val text = context.getString(
            if (result.eligible) TranStrings.Eligibility.resultReasonMeets else TranStrings.Eligibility.resultReasonBelow,
            result.age.toString(),
            result.minimumAge.toString(),
            result.countryCode,
        )
        OfflineCheck(text, age.toInt())
    } catch (e: TranValidationException.ValidationException) {
        OfflineCheck(invalidCountry, null)
    }
}
