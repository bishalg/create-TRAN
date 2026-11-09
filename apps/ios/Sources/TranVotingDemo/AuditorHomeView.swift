import SwiftUI

/// Auditor dashboard displaying the global voting rules matrix.
/// Verifies: REQ-NAV-004 REQ-NAV-005
struct AuditorHomeView: View {
    let onSignOut: () -> Void

    /// The rule table from `rust-core` — the same rows the verdict reads.
    private let countryRules = supportedCountriesOffline()

    var body: some View {
        TranScreen {
            ScrollView {
                TranBox(padding: .lg) {
                    TranStack(gap: .lg, alignment: .leading) {
                        TranInline(gap: .md) {
                            TranStack(gap: .xs, alignment: .leading) {
                                // The title names the role, so it is the role badge here.
                                TranText(L10n.Common.roleElectionAuditor, variant: .title)
                                    .accessibilityIdentifier(ScreenContract.Auditor.roleBadge)
                                TranText(L10n.Auditor.subtitle, variant: .muted)
                            }
                            // The titles take what the button leaves, wrapping on a narrow screen or at
                            // the largest text size, as on Android (REQ-NAT-004, REQ-NAT-013).
                            .frame(maxWidth: .infinity, alignment: .leading)
                            TranButton(label: L10n.Common.signOut, variant: .secondary, size: .md) {
                                onSignOut()
                            }
                            .accessibilityIdentifier(ScreenContract.Auditor.signOutButton)
                        }

                        TranSurface {
                            TranStack(gap: .base, alignment: .leading) {
                                TranText(L10n.Auditor.rulesTitle, variant: .title)

                                // Table-like rows compose from the stack/inline atoms (no native
                                // `TranTable` — the web table is a CSS grid with no native analogue).
                                ForEach(countryRules, id: \.countryCode) { rule in
                                    TranInline(gap: .md) {
                                        TranText(rule.countryCode, bold: true)
                                        Spacer()
                                        TranText(L10n.Auditor.years(String(rule.minimumAge)), variant: .muted)
                                    }
                                    .frame(maxWidth: .infinity)
                                    TranDivider()
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}
