// Verifies: REQ-VER-009
package com.tran.voting.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.tran.voting.generated.ScreenContract
import com.tran.voting.generated.TranSpace
import com.tran.voting.generated.TranStrings
import com.tran.voting.ui.atoms.TranButton
import com.tran.voting.ui.atoms.TranGap
import com.tran.voting.ui.atoms.TranScreen
import com.tran.voting.ui.atoms.TranStack
import com.tran.voting.ui.atoms.TranText
import com.tran.voting.ui.atoms.TranTextVariant
import com.tran.voting.ui.feedback.TranFeedback
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.errorSpec

/**
 * The `screen` presentation of `client.upgrade_required` (REQ-VER-009): the API no longer serves
 * this version. It replaces everything, Back does not leave it, and its one action opens the store
 * page. The session and the vault are untouched: the updated app opens signed in.
 */
@Composable
fun UpdateRequiredScreen(onUpdate: () -> Unit) {
    // Nothing behind it may be reached: the API refuses this version on every product route.
    BackHandler(enabled = true) {}
    val title = TranFeedback.messageRes(errorSpec(TranErrorCode.CLIENT_UPGRADE_REQUIRED).messageKey)
    TranScreen(modifier = Modifier.verticalScroll(rememberScrollState()).padding(TranSpace.lg)) {
        TranStack(gap = TranGap.LG) {
            TranStack(gap = TranGap.SM) {
                TranText(
                    text = stringResource(title),
                    variant = TranTextVariant.TITLE,
                    modifier = Modifier.semantics { heading() },
                )
                TranText(text = stringResource(TranStrings.Errors.updateRequiredBody))
            }
            TranButton(
                label = stringResource(TranStrings.Common.update),
                onClick = onUpdate,
                modifier = Modifier.fillMaxWidth().testTag(ScreenContract.Eligibility.updateButton),
            )
        }
    }
}
