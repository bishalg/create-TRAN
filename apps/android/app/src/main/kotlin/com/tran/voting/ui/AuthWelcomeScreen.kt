package com.tran.voting.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import com.tran.voting.generated.BrandPalette
import com.tran.voting.generated.TranStrings

/**
 * Welcome screen presenting the two branching navigation options.
 *
 * Verifies: REQ-NAV-002 REQ-NAV-003 REQ-NAV-004
 */
@Composable
fun AuthWelcomeScreen(
    palette: BrandPalette,
    onSelectRole: (UserRole) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background)
            .safeDrawingPadding()
            .semantics { testTagsAsResourceId = true }
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = stringResource(TranStrings.Auth.welcomeTitle),
                style = MaterialTheme.typography.headlineLarge,
                color = palette.textPrimary
            )
            Text(
                text = stringResource(TranStrings.Auth.welcomeSubtitle),
                style = MaterialTheme.typography.bodyLarge,
                color = palette.textPrimary.copy(alpha = 0.8f)
            )
        }

        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Button(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("voter-branch-button"),
                onClick = { onSelectRole(UserRole.CITIZEN_VOTER) }
            ) {
                Text(stringResource(TranStrings.Auth.continueAsVoter))
            }

            OutlinedButton(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("auditor-branch-button"),
                onClick = { onSelectRole(UserRole.ELECTION_AUDITOR) }
            ) {
                Text(stringResource(TranStrings.Auth.continueAsAuditor))
            }
        }
    }
}
