package com.tran.voting.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.tran.voting.generated.TranSpace
import com.tran.voting.generated.TranStrings
import com.tran.voting.ui.atoms.TranButton
import com.tran.voting.ui.atoms.TranButtonVariant
import com.tran.voting.ui.atoms.TranGap
import com.tran.voting.ui.atoms.TranScreen
import com.tran.voting.ui.atoms.TranStack
import com.tran.voting.ui.atoms.TranText
import com.tran.voting.ui.atoms.TranTextVariant

/**
 * Welcome screen presenting the two branching navigation options.
 *
 * Verifies: REQ-NAV-002 REQ-NAV-003 REQ-NAV-004
 */
@Composable
fun AuthWelcomeScreen(onSelectRole: (UserRole) -> Unit) {
    TranScreen(modifier = Modifier.padding(TranSpace.lg)) {
        TranStack(gap = TranGap.LG) {
            TranStack(gap = TranGap.SM) {
                TranText(
                    text = stringResource(TranStrings.Auth.welcomeTitle),
                    variant = TranTextVariant.DISPLAY,
                )
                TranText(
                    text = stringResource(TranStrings.Auth.welcomeSubtitle),
                    variant = TranTextVariant.MUTED,
                )
            }

            TranStack(gap = TranGap.MD) {
                TranButton(
                    label = stringResource(TranStrings.Auth.continueAsVoter),
                    onClick = { onSelectRole(UserRole.CITIZEN_VOTER) },
                    modifier = Modifier.fillMaxWidth().testTag("voter-branch-button"),
                )
                TranButton(
                    label = stringResource(TranStrings.Auth.continueAsAuditor),
                    onClick = { onSelectRole(UserRole.ELECTION_AUDITOR) },
                    variant = TranButtonVariant.SECONDARY,
                    modifier = Modifier.fillMaxWidth().testTag("auditor-branch-button"),
                )
            }
        }
    }
}
