package com.tran.voting.ui.feedback

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.res.stringResource
import com.tran.voting.generated.TranSpace
import com.tran.voting.generated.TranStrings
import com.tran.voting.ui.atoms.TranDialog
import com.tran.voting.ui.atoms.TranToast
import kotlinx.coroutines.delay

/**
 * Renders [feedback] over the whole app: the toast at the bottom, timed by the catalogue, and the
 * pending confirmation as a dialog. Composes atoms only.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun TranFeedbackHost(feedback: TranFeedback, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) {
        content()
        feedback.toast?.let { toast ->
            LaunchedEffect(toast.id) {
                delay(toast.durationMs)
                if (feedback.toast?.id == toast.id) feedback.dismissToast()
            }
            TranToast(
                tone = toast.tone,
                message = stringResource(toast.messageRes),
                reference = toast.requestId?.let { stringResource(TranStrings.Errors.reference, it) },
                dismissLabel = stringResource(TranStrings.Common.dismiss),
                onDismiss = feedback::dismissToast,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(TranSpace.md),
            )
        }
        feedback.confirmation?.let { pending ->
            TranDialog(
                title = stringResource(pending.titleRes),
                message = stringResource(pending.bodyRes),
                confirmLabel = stringResource(pending.confirmRes),
                cancelLabel = stringResource(TranStrings.Common.cancel),
                destructive = pending.destructive,
                onConfirm = pending.onConfirm,
                onCancel = feedback::cancelConfirmation,
            )
        }
    }
}
