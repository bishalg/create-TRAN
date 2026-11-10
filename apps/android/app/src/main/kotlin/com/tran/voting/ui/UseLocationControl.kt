// Verifies: REQ-PRV-003 REQ-PRV-004 REQ-PRV-007
package com.tran.voting.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranStrings
import com.tran.voting.permissions.LocationCountry
import com.tran.voting.permissions.LocationPrompt
import com.tran.voting.permissions.PermissionCopy
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
 * "Use my location" under the country field (spec 026). A tap asks Rust what to do next; the
 * priming is a dialog with the catalogue's title and body, and after a permanent refusal one quiet
 * note with "Open Settings" sits under the control. Nothing here is an error.
 */
@Composable
fun UseLocationControl(location: LocationCountry, onCountry: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val entry = remember { permissionEntry(TranPermissionId.LOCATION_APPROXIMATE) }
    TranStack(gap = TranGap.SM) {
        TranButton(
            label = stringResource(TranStrings.Eligibility.locationUse),
            onClick = { scope.launch { location.use()?.let(onCountry) } },
            variant = TranButtonVariant.SECONDARY,
            size = TranButtonSize.MD,
            modifier = Modifier.testTag(ScreenContract.Eligibility.useLocationButton),
        )
        when (location.prompt) {
            LocationPrompt.PRIMING -> TranDialog(
                title = stringResource(copy(entry.primingTitleKey)),
                message = stringResource(copy(entry.primingBodyKey)),
                confirmLabel = stringResource(TranStrings.Common.continueAction),
                cancelLabel = stringResource(TranStrings.Common.notNow),
                destructive = false,
                onConfirm = { scope.launch { location.proceed()?.let(onCountry) } },
                onCancel = location::dismiss,
                confirmTag = ScreenContract.Eligibility.locationPrimingContinue,
                cancelTag = ScreenContract.Eligibility.locationPrimingDismiss,
            )
            LocationPrompt.SETTINGS_NOTE -> {
                TranText(
                    text = stringResource(copy(entry.settingsNoteKey)),
                    variant = TranTextVariant.MUTED,
                    modifier = Modifier.testTag(ScreenContract.Eligibility.locationSettingsNote),
                )
                TranButton(
                    label = stringResource(TranStrings.Common.openSettings),
                    onClick = location::openSettings,
                    variant = TranButtonVariant.SECONDARY,
                    size = TranButtonSize.MD,
                    modifier = Modifier.testTag(ScreenContract.Eligibility.locationOpenSettings),
                )
            }
            LocationPrompt.NONE -> Unit
        }
    }
}

/** `PermissionParityTest` proves every catalogue key has a resource. */
private fun copy(key: String): Int = requireNotNull(PermissionCopy.res(key)) { "no string resource for $key" }
