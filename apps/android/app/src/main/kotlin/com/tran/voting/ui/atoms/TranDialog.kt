package com.tran.voting.ui.atoms

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId

/**
 * Blocking choice (REQ-ERR-007) — the web `TranDialog` atom. A destructive confirm is coloured as
 * such; back, a tap outside and Cancel all keep the current state.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun TranDialog(
    title: String,
    message: String,
    confirmLabel: String,
    cancelLabel: String,
    destructive: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    val palette = LocalTranPalette.current
    AlertDialog(
        onDismissRequest = onCancel,
        // A dialog is its own window: expose its tags to UI automation (Maestro) here too.
        modifier = Modifier.semantics { testTagsAsResourceId = true },
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                modifier = Modifier.testTag("dialog-confirm"),
                colors = if (destructive) {
                    ButtonDefaults.textButtonColors(contentColor = palette.danger)
                } else {
                    ButtonDefaults.textButtonColors()
                },
            ) { Text(confirmLabel) }
        },
        dismissButton = {
            TextButton(onClick = onCancel, modifier = Modifier.testTag("dialog-cancel")) { Text(cancelLabel) }
        },
    )
}
