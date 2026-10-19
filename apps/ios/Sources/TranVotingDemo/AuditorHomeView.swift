import SwiftUI

/// Auditor dashboard displaying the global voting rules matrix.
/// Verifies: REQ-NAV-004 REQ-NAV-005
struct AuditorHomeView: View {
    let onSignOut: () -> Void

    private let countryRules: [(String, Int)] = [
        ("BR", 16),
        ("NP", 18),
        ("US", 18),
        ("IN", 18),
        ("DE", 18),
        ("FR", 18),
        ("GB", 18)
    ]

    var body: some View {
        TranScreen {
            ScrollView {
                TranBox(padding: .lg) {
                    TranStack(gap: .lg, alignment: .leading) {
                        TranInline(gap: .md) {
                            TranStack(gap: .xs, alignment: .leading) {
                                TranText(L10n.Common.roleElectionAuditor, variant: .title)
                                TranText(L10n.Auditor.subtitle, variant: .muted)
                            }
                            Spacer()
                            TranButton(label: L10n.Common.signOut, variant: .secondary, size: .md) {
                                onSignOut()
                            }
                            .accessibilityIdentifier("sign-out-button")
                        }

                        TranSurface {
                            TranStack(gap: .base, alignment: .leading) {
                                TranText(L10n.Auditor.rulesTitle, variant: .title)

                                // Table-like rows compose from the stack/inline atoms (no native
                                // `TranTable` — the web table is a CSS grid with no native analogue).
                                ForEach(countryRules, id: \.0) { item in
                                    TranInline(gap: .md) {
                                        TranText(item.0, bold: true)
                                        Spacer()
                                        TranText(L10n.Auditor.years(String(item.1)), variant: .muted)
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
