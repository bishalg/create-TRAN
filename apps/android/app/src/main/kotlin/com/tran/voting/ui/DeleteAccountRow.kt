// Verifies: REQ-ACC-004 REQ-ACC-006
package com.tran.voting.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.tran.voting.generated.TranStrings
import com.tran.voting.ui.atoms.TranButton
import com.tran.voting.ui.atoms.TranButtonSize
import com.tran.voting.ui.atoms.TranButtonVariant
import com.tran.voting.ui.atoms.TranGap
import com.tran.voting.ui.atoms.TranInline

/**
 * "Delete account", right under sign-out on every signed-in screen (REQ-ACC-004). A row of its own
 * rather than a second button in the header: on a 320 dp screen at the largest text scale the
 * header has no room for two buttons beside the titles (docs/LEARNINGS.md, 2026-10-22), and here
 * the label can take the whole width. Danger-coloured, because it destroys the account; disabled
 * while a deletion is in flight, so it cannot start a second one (REQ-ACC-006).
 */
@Composable
fun DeleteAccountRow(onDeleteAccount: () -> Unit, tag: String, enabled: Boolean = true) {
    TranInline(gap = TranGap.MD, modifier = Modifier.fillMaxWidth()) {
        Spacer(Modifier.weight(1f))
        TranButton(
            label = stringResource(TranStrings.Common.deleteAccount),
            onClick = onDeleteAccount,
            variant = TranButtonVariant.DANGER,
            size = TranButtonSize.MD,
            enabled = enabled,
            modifier = Modifier.testTag(tag),
        )
    }
}
