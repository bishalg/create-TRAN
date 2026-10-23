package com.tran.voting.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.tran.voting.generated.TranSpace
import com.tran.voting.generated.TranStrings
import com.tran.voting.ui.atoms.TranButton
import com.tran.voting.ui.atoms.TranButtonSize
import com.tran.voting.ui.atoms.TranButtonVariant
import com.tran.voting.ui.atoms.TranDivider
import com.tran.voting.ui.atoms.TranGap
import com.tran.voting.ui.atoms.TranInline
import com.tran.voting.ui.atoms.TranScreen
import com.tran.voting.ui.atoms.TranStack
import com.tran.voting.ui.atoms.TranText
import com.tran.voting.ui.atoms.TranTextVariant
import uniffi.tran_uniffi.supportedCountriesOffline

/**
 * Auditor dashboard screen displaying the global voting rules matrix.
 *
 * Verifies: REQ-NAV-004 REQ-NAV-005
 */
@Composable
fun AuditorScreen(onSignOut: () -> Unit) {
    // The rule table from rust-core — the same rows the verdict reads.
    val rules = remember { supportedCountriesOffline() }

    TranScreen(modifier = Modifier.padding(TranSpace.lg)) {
        TranStack(gap = TranGap.LG) {
            TranInline(gap = TranGap.MD, modifier = Modifier.fillMaxWidth()) {
                // The titles take what the button leaves, wrapping on a narrow screen (REQ-NAT-013).
                TranStack(gap = TranGap.XS, modifier = Modifier.weight(1f)) {
                    TranText(
                        text = stringResource(TranStrings.Common.roleElectionAuditor),
                        variant = TranTextVariant.TITLE,
                    )
                    TranText(
                        text = stringResource(TranStrings.Auditor.subtitle),
                        variant = TranTextVariant.MUTED,
                    )
                }
                TranButton(
                    label = stringResource(TranStrings.Common.signOut),
                    onClick = onSignOut,
                    variant = TranButtonVariant.SECONDARY,
                    size = TranButtonSize.MD,
                    modifier = Modifier.testTag("sign-out-button"),
                )
            }

            TranText(
                text = stringResource(TranStrings.Auditor.rulesTitle),
                variant = TranTextVariant.TITLE,
            )

            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(TranSpace.sm),
            ) {
                items(rules) { rule ->
                    TranInline(
                        gap = TranGap.MD,
                        modifier = Modifier.fillMaxWidth().padding(vertical = TranSpace.xs),
                    ) {
                        TranText(text = rule.countryCode, bold = true)
                        Spacer(Modifier.weight(1f))
                        TranText(
                            text = stringResource(TranStrings.Auditor.years, rule.minimumAge.toInt()),
                            variant = TranTextVariant.MUTED,
                        )
                    }
                    TranDivider()
                }
            }
        }
    }
}
