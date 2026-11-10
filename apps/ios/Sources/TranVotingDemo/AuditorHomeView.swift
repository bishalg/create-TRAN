import SwiftUI

/// Auditor dashboard displaying the global voting rules matrix.
/// Verifies: REQ-NAV-004 REQ-NAV-005 REQ-ACC-004
struct AuditorHomeView: View {
    let onSignOut: () -> Void
    /// Asks, then deletes; a failure comes back for the banner below the header (REQ-ACC-006).
    let onDeleteAccount: TranAccountDeletion.Request
    @State private var banner: TranRequestFailure?

    /// The rule table from `rust-core` — the same rows the verdict reads.
    private let countryRules = supportedCountriesOffline()

    var body: some View {
        TranScreen {
            ScrollView {
                TranBox(padding: .lg) {
                    TranStack(gap: .lg, alignment: .leading) {
                        SignedInHeader(
                            signOutId: ScreenContract.Auditor.signOutButton,
                            deleteAccountId: ScreenContract.Auditor.deleteAccountButton,
                            onSignOut: onSignOut,
                            onDeleteAccount: { onDeleteAccount { failure in failed(failure) } }
                        ) {
                            TranStack(gap: .xs, alignment: .leading) {
                                // The title names the role, so it is the role badge here.
                                TranText(L10n.Common.roleElectionAuditor, variant: .title, label: L10n.Common.roleLabel)
                                    .accessibilityIdentifier(ScreenContract.Auditor.roleBadge)
                                TranText(L10n.Auditor.subtitle, variant: .muted)
                            }
                        }
                        // A deletion that could not reach the server says so here, as the
                        // catalogue's banner; the screen has no other network call (REQ-ACC-006).
                        if let banner {
                            TranBanner(message: TranFeedback.message(banner.spec.messageKey))
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

    /// Any other answer came from the server, so an older offline banner no longer holds.
    private func failed(_ failure: TranRequestFailure) {
        if case .banner = failure.spec.presentation { banner = failure } else { banner = nil }
    }
}
