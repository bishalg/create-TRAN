// Verifies: REQ-PSH-008 REQ-PRV-003 REQ-PRV-004
package com.tran.voting.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranStrings
import com.tran.voting.permissions.PermissionCopy
import com.tran.voting.permissions.PermissionPrompt
import com.tran.voting.push.NotificationReminder
import com.tran.voting.ui.atoms.TranButton
import com.tran.voting.ui.atoms.TranButtonSize
import com.tran.voting.ui.atoms.TranButtonVariant
import com.tran.voting.ui.atoms.TranDialog
import com.tran.voting.ui.atoms.TranGap
import com.tran.voting.ui.atoms.TranStack
import com.tran.voting.ui.atoms.TranText
import com.tran.voting.ui.atoms.TranTextVariant
import kotlinx.coroutines.launch
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.permissionEntry

/**
 * "Notify me when I can vote" beside a "not yet eligible" verdict (spec 027). Shaped like "Use my
 * location": a tap asks Rust what to do next, the priming is a dialog with the catalogue's copy,
 * and after a permanent refusal one quiet note with "Open Settings" sits under the control.
 */
@Composable
fun NotifyMeControl(reminder: NotificationReminder) {
    val scope = rememberCoroutineScope()
    val entry = remember { permissionEntry(TranPermissionId.NOTIFICATIONS) }
    TranStack(gap = TranGap.SM) {
        TranButton(
            label = stringResource(TranStrings.Eligibility.notifyLabel),
            onClick = { scope.launch { reminder.ask() } },
            variant = TranButtonVariant.SECONDARY,
            size = TranButtonSize.MD,
            modifier = Modifier.testTag(ScreenContract.Eligibility.notifyMeButton),
        )
        when (reminder.prompt) {
            PermissionPrompt.PRIMING -> TranDialog(
                title = stringResource(copy(entry.primingTitleKey)),
                message = stringResource(copy(entry.primingBodyKey)),
                confirmLabel = stringResource(TranStrings.Common.continueAction),
                cancelLabel = stringResource(TranStrings.Common.notNow),
                destructive = false,
                onConfirm = { scope.launch { reminder.proceed() } },
                onCancel = reminder::dismiss,
                confirmTag = ScreenContract.Eligibility.notifyPrimingContinue,
                cancelTag = ScreenContract.Eligibility.notifyPrimingDismiss,
            )
            PermissionPrompt.SETTINGS_NOTE -> {
                TranText(
                    text = stringResource(copy(entry.settingsNoteKey)),
                    variant = TranTextVariant.MUTED,
                    modifier = Modifier.testTag(ScreenContract.Eligibility.notifySettingsNote),
                )
                TranButton(
                    label = stringResource(TranStrings.Common.openSettings),
                    onClick = reminder::openSettings,
                    variant = TranButtonVariant.SECONDARY,
                    size = TranButtonSize.MD,
                    modifier = Modifier.testTag(ScreenContract.Eligibility.notifyOpenSettings),
                )
            }
            PermissionPrompt.NONE -> Unit
        }
    }
}

/** `PermissionParityTest` proves every catalogue key has a resource. */
private fun copy(key: String): Int = requireNotNull(PermissionCopy.res(key)) { "no string resource for $key" }
