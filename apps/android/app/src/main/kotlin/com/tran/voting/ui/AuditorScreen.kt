package com.tran.voting.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import com.tran.voting.generated.BrandPalette
import com.tran.voting.generated.TranStrings

/**
 * Auditor dashboard screen displaying the global voting rules matrix.
 *
 * Verifies: REQ-NAV-004 REQ-NAV-005
 */
@Composable
fun AuditorScreen(
    palette: BrandPalette,
    onSignOut: () -> Unit
) {
    val rules = listOf(
        "BR" to 16,
        "NP" to 18,
        "US" to 18,
        "IN" to 18,
        "DE" to 18,
        "FR" to 18,
        "GB" to 18
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background)
            .safeDrawingPadding()
            .semantics { testTagsAsResourceId = true }
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = stringResource(TranStrings.Common.roleElectionAuditor),
                    style = MaterialTheme.typography.titleLarge,
                    color = palette.textPrimary
                )
                Text(
                    text = stringResource(TranStrings.Auditor.subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = palette.textPrimary.copy(alpha = 0.8f)
                )
            }
            Button(
                modifier = Modifier.testTag("sign-out-button"),
                onClick = onSignOut
            ) {
                Text(stringResource(TranStrings.Common.signOut))
            }
        }

        Text(
            text = stringResource(TranStrings.Auditor.rulesTitle),
            style = MaterialTheme.typography.titleMedium,
            color = palette.textPrimary
        )

        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(rules) { (country, age) ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = country,
                        style = MaterialTheme.typography.bodyLarge,
                        color = palette.textPrimary
                    )
                    Text(
                        text = stringResource(TranStrings.Auditor.years, age),
                        style = MaterialTheme.typography.bodyLarge,
                        color = palette.textPrimary.copy(alpha = 0.9f)
                    )
                }
                HorizontalDivider(color = palette.textPrimary.copy(alpha = 0.2f))
            }
        }
    }
}
