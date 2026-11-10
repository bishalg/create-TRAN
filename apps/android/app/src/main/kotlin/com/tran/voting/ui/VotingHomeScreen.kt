package com.tran.voting.ui

import android.content.Context
import androidx.compose.animation.animateContentSize
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.tran.voting.api.RecoveryProbe
import com.tran.voting.api.ServerConfirmation
import com.tran.voting.api.TranApiClient
import com.tran.voting.api.TranApiStatus
import com.tran.voting.api.TranRequestFailure
import com.tran.voting.api.listenForConnectivity
import com.tran.voting.api.tranApiStatusFrom
import com.tran.voting.generated.ScreenContract
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
import kotlinx.coroutines.launch
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranPresentation
import uniffi.tran_uniffi.TranUserAction
import uniffi.tran_uniffi.TranValidationException
import uniffi.tran_uniffi.errorSpec
import uniffi.tran_uniffi.evaluateVoteEligibilityOffline

/** Voting demo — brand tokens + offline rust-core rules via UniFFI. Copy comes from the shared dictionaries through generated `TranStrings` accessors. */
@Composable
fun VotingHomeScreen(
    theme: TranTheme,
    onThemeChange: (TranTheme) -> Unit,
    onSignOut: (() -> Unit)? = null,
    api: TranApiClient = TranApiClient(),
    // Shown beside sign-out (REQ-ACC-004); the coordinator owns the request.
    onDeleteAccount: (() -> Unit)? = null,
    // A deletion is in flight: the control waits for its answer (REQ-ACC-006).
    deleting: Boolean = false,
    // The last failed deletion: a banner failure is this screen's to show (REQ-ACC-006, REQ-ERR-006).
    accountFailure: TranRequestFailure? = null,
) {
    var ageText by remember { mutableStateOf("20") }
    var countryCode by remember { mutableStateOf("NP") }
    val resultPlaceholder = stringResource(TranStrings.Eligibility.resultPlaceholder)
    var resultText by remember { mutableStateOf(resultPlaceholder) }
    var apiStatus by remember { mutableStateOf(TranApiStatus.CHECKING) }
    // A connectivity failure shown until a call succeeds (REQ-ERR-006).
    var banner by remember { mutableStateOf<TranRequestFailure?>(null) }
    // Why the last check was refused; verdicts stay in `resultText` (REQ-NAT-002, ADR-0038).
    var validationMessage by remember { mutableStateOf<String?>(null) }
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
    // Each failed deletion is a new object, so a repeat shows again.
    LaunchedEffect(accountFailure) {
        accountFailure?.let(::record)
    }

    // The banner recovers by itself: probe on the Rust schedule, and at once when the network
    // returns or the app comes back to the foreground (REQ-ERR-013).
    val recovery = remember(scope) { RecoveryProbe(scope) }
    val offline = banner != null
    LaunchedEffect(offline) {
        if (offline) {
            recovery.start(probe = { api.probeHealth() }, onRecovered = { record(null) })
        } else {
            recovery.stop()
        }
    }
    DisposableEffect(recovery) {
        // The callback runs on a binder thread; the probe lives on the main thread.
        val stopListening = listenForConnectivity(context) { scope.launch { recovery.nudge() } }
        onDispose {
            stopListening()
            recovery.stop()
        }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, recovery) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) recovery.nudge()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    TranScreen(
        modifier = Modifier
            .verticalScroll(rememberScrollState())
            .padding(TranSpace.lg),
    ) {
        TranStack(gap = TranGap.MD) {
            TranInline(gap = TranGap.MD, modifier = Modifier.fillMaxWidth()) {
                // The titles take what the button leaves, wrapping on a narrow screen (REQ-NAT-013).
                TranStack(gap = TranGap.XS, modifier = Modifier.weight(1f)) {
                    TranText(
                        text = stringResource(TranStrings.Shell.header, "Android"),
                        variant = TranTextVariant.TITLE,
                    )
                    TranText(
                        text = stringResource(TranStrings.Eligibility.subtitle),
                        variant = TranTextVariant.MUTED,
                    )
                    TranText(
                        text = stringResource(TranStrings.Common.roleCitizenVoter),
                        variant = TranTextVariant.CAPTION,
                        label = stringResource(TranStrings.Common.roleLabel),
                        modifier = Modifier.testTag(ScreenContract.Eligibility.roleBadge),
                    )
                }
                if (onSignOut != null) {
                    TranButton(
                        label = stringResource(TranStrings.Common.signOut),
                        onClick = onSignOut,
                        variant = TranButtonVariant.SECONDARY,
                        size = TranButtonSize.MD,
                        modifier = Modifier.testTag(ScreenContract.Eligibility.signOutButton),
                    )
                }
            }
            if (onDeleteAccount != null) {
                DeleteAccountRow(onDeleteAccount, ScreenContract.Eligibility.deleteAccountButton, enabled = !deleting)
            }
            TranInline(gap = TranGap.SM, modifier = Modifier.fillMaxWidth()) {
                TranField(
                    label = stringResource(TranStrings.Eligibility.ageLabel),
                    value = ageText,
                    onValueChange = { ageText = it },
                    modifier = Modifier.weight(1f).testTag(ScreenContract.Eligibility.ageField),
                )
                TranField(
                    label = stringResource(TranStrings.Eligibility.countryLabel),
                    value = countryCode,
                    onValueChange = { countryCode = it.uppercase() },
                    modifier = Modifier.weight(1f).testTag(ScreenContract.Eligibility.countryField),
                )
            }
            TranButton(
                label = stringResource(TranStrings.Eligibility.checkOffline),
                onClick = {
                    val check = runOfflineCheck(context, ageText, countryCode)
                    val country = countryCode
                    // A refusal is never read as a verdict: the result goes back to its placeholder.
                    resultText = check.verdict ?: resultPlaceholder
                    validationMessage = check.problem
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
                modifier = Modifier.testTag(ScreenContract.Eligibility.checkButton),
            )
            validationMessage?.let {
                TranText(
                    text = it,
                    variant = TranTextVariant.DANGER,
                    live = true,
                    label = stringResource(TranStrings.Eligibility.validationLabel),
                    modifier = Modifier.testTag(ScreenContract.Eligibility.validationMessage),
                )
            }
            TranText(
                text = resultText,
                modifier = Modifier.testTag(ScreenContract.Eligibility.offlineResult),
                live = true,
                label = stringResource(TranStrings.Eligibility.resultLabel),
            )
            // REQ-LOAD-002/003/005: the verdict stays; its live caption says it is being checked
            // (after the policy delay) or who vouched for it.
            if (hasVerdict) {
                TranText(
                    text = stringResource(TranFeedback.messageRes(confirmation.captionKey)),
                    variant = TranTextVariant.CAPTION,
                    live = true,
                    label = stringResource(TranStrings.Eligibility.resultSource),
                    modifier = Modifier
                        .animateContentSize(TranMotion.spec(reduceMotion))
                        .testTag(ScreenContract.Eligibility.verdictSource),
                )
            }
            // Theme choices come from the rust-core registry: every palette renders here after
            // `pnpm tokens:sync`, with its label from the shared dictionaries (`shell.theme.*`).
            TranSegmented(
                options = TranTheme.entries,
                selected = theme,
                onSelect = onThemeChange,
                modifier = Modifier.fillMaxWidth(),
                testTag = ScreenContract.Eligibility.themePicker,
                optionName = { it.id },
                accessibilityLabel = stringResource(TranStrings.Shell.themeLabel),
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
                label = stringResource(TranStrings.Shell.statusLabel),
                modifier = Modifier.testTag(ScreenContract.Eligibility.apiStatus),
            )
            banner?.let {
                TranBanner(
                    message = stringResource(TranFeedback.messageRes(it.spec.messageKey)),
                    modifier = Modifier.testTag(ScreenContract.Eligibility.offlineNotice),
                )
            }
        }
    }
}

/**
 * The verdict sentence or the reason it was refused, plus the validated age when the input was
 * good enough for the API call.
 */
private data class OfflineCheck(val verdict: String?, val problem: String?, val age: Int?)

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
): OfflineCheck {
    // Only parsing happens here; every rule (age range, country shape) is checked once, in Rust.
    // An age that is not a whole number is out of range, in the catalogue's words.
    val age = ageText.toUShortOrNull() ?: return OfflineCheck(
        verdict = null,
        problem = context.getString(TranFeedback.messageRes(errorSpec(TranErrorCode.VALIDATION_AGE_OUT_OF_RANGE).messageKey)),
        age = null,
    )
    val reference = tranReferenceDate()
    return try {
        val result = evaluateVoteEligibilityOffline(age, null, countryCode, reference)
        OfflineCheck(verdict = result.localizedReason(context), problem = null, age = age.toInt())
    } catch (e: TranValidationException) {
        OfflineCheck(verdict = null, problem = context.getString(e.localizedMessageRes()), age = null)
    }
}
