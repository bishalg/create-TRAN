package com.tran.voting.ui

import android.content.Context
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import com.tran.voting.api.ServerConfirmation
import com.tran.voting.api.TranApiClient
import com.tran.voting.api.TranApiStatus
import com.tran.voting.api.TranRequestFailure
import com.tran.voting.api.tranApiStatusFrom
import com.tran.voting.generated.TranSpace
import com.tran.voting.generated.TranStrings
import com.tran.voting.generated.TranTheme
import com.tran.voting.generated.labelRes
import com.tran.voting.ui.atoms.TranBanner
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
import com.tran.voting.ui.feedback.LocalTranFeedback
import com.tran.voting.ui.feedback.TranFeedback
import kotlinx.coroutines.CancellationException
import uniffi.tran_uniffi.TranPresentation
import uniffi.tran_uniffi.TranUserAction
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
    // A connectivity failure shown until a call succeeds (REQ-ERR-006).
    var banner by remember { mutableStateOf<TranRequestFailure?>(null) }
    val invalidAge = stringResource(TranStrings.Errors.ageInvalid)
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val feedback = LocalTranFeedback.current
    // One confirmation at a time: a new check cancels the one in flight, and leaving the screen
    // cancels it too (the scope would, but say so); a cancelled one is silent (REQ-LOAD-004).
    val confirmation = remember(scope) { ServerConfirmation(scope) }
    DisposableEffect(confirmation) { onDispose { confirmation.cancel() } }
    // The source caption belongs to a verdict; an input error has none.
    var hasVerdict by remember { mutableStateOf(false) }
    val reduceMotion = rememberReduceMotion()

    fun record(failure: TranRequestFailure?) {
        apiStatus = failure?.let(::tranApiStatusFrom) ?: TranApiStatus.ONLINE
        banner = failure?.takeIf { it.spec.presentation is TranPresentation.Banner }
    }

    // REQ-NAT-011: the status pill mirrors the web footer; it never gates the device check.
    // A background call the user did not start: log it, never toast.
    LaunchedEffect(Unit) {
        record(attempt { api.checkHealth() }?.also(feedback::log))
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
                    val check = runOfflineCheck(context, ageText, countryCode, invalidAge)
                    val country = countryCode
                    resultText = check.text
                    hasVerdict = check.age != null
                    // REQ-NAT-011: the verdict is already on screen; the API call only moves the status pill
                    // and the source caption. The server confirms in the background, retrying transient
                    // failures; the catalogue decides how the outcome is shown.
                    val age = check.age
                    if (age == null) {
                        confirmation.cancel()
                    } else {
                        confirmation.start(run = { api.confirmEligibility(age, country) }) { failure ->
                            record(failure)
                            if (failure == null) {
                                feedback.acknowledge(TranUserAction.SERVER_CHECK_SUCCEEDED)
                            } else {
                                feedback.report(failure)
                            }
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
            // REQ-LOAD-002/003/005: the verdict stays; its live caption says it is being checked
            // (after the policy delay) or who vouched for it.
            if (hasVerdict) {
                TranText(
                    text = stringResource(TranFeedback.messageRes(confirmation.captionKey)),
                    variant = TranTextVariant.CAPTION,
                    live = true,
                    modifier = Modifier
                        .animateContentSize(TranMotion.spec(reduceMotion))
                        .testTag("verdict-source"),
                )
            }
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
            banner?.let {
                TranBanner(
                    message = stringResource(TranFeedback.messageRes(it.spec.messageKey)),
                    modifier = Modifier.testTag("offline-notice"),
                )
            }
        }
    }
}

/** The verdict text plus the validated age, when the input was good enough for the API call. */
private data class OfflineCheck(val text: String, val age: Int?)

/** Runs a call; returns its classified failure, or `null` on success. Cancellation still propagates. */
private suspend fun attempt(block: suspend () -> Unit): TranRequestFailure? = try {
    block()
    null
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (error: Exception) {
    TranRequestFailure.classify(error)
}

/** Every message shown comes from string resources; the core's English `reason`/`detail` is never displayed. */
private fun runOfflineCheck(
    context: Context,
    ageText: String,
    countryCode: String,
    invalidAge: String,
): OfflineCheck {
    // Only parsing happens here; every rule (age range, country shape) is checked once, in Rust.
    val age = ageText.toUShortOrNull() ?: return OfflineCheck(invalidAge, null)
    val reference = tranReferenceDate()
    return try {
        val result = evaluateVoteEligibilityOffline(age, null, countryCode, reference)
        OfflineCheck(result.localizedReason(context), age.toInt())
    } catch (e: TranValidationException) {
        OfflineCheck(context.getString(e.localizedMessageRes()), null)
    }
}
