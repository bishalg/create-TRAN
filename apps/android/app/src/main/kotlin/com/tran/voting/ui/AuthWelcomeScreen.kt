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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import com.tran.voting.generated.BrandPalette
import com.tran.voting.generated.TranBrandTokens

/**
 * Welcome screen presenting the two branching navigation options.
 *
 * Verifies: REQ-NAV-002 REQ-NAV-003 REQ-NAV-004
 */
@Composable
fun AuthWelcomeScreen(
    useDark: Boolean = true,
    onSelectRole: (UserRole) -> Unit
) {
    val palette: BrandPalette = if (useDark) TranBrandTokens.Dark else TranBrandTokens.Light

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
                text = "TRAN Voting",
                style = MaterialTheme.typography.headlineLarge,
                color = palette.textPrimary
            )
            Text(
                text = "Select your access role to continue:",
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
                Text("Continue as Citizen Voter")
            }

            OutlinedButton(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("auditor-branch-button"),
                onClick = { onSelectRole(UserRole.ELECTION_AUDITOR) }
            ) {
                Text("Continue as Election Auditor")
            }
        }
    }
}
