import SwiftUI

/// The header of every signed-in screen: its titles, then the account actions, sign-out and
/// "Delete account" side by side in one column (REQ-ACC-004). The titles take what the buttons
/// leave, wrapping on a narrow screen. At the accessibility text sizes the buttons move under the
/// titles at full width, so neither squeezes the titles to nothing nor leaves the window
/// (REQ-NAT-004, REQ-NAT-013).
struct SignedInHeader<Titles: View>: View {
    let signOutId: String
    let deleteAccountId: String
    let onSignOut: () -> Void
    let onDeleteAccount: () -> Void
    @ViewBuilder var titles: Titles

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// While a deletion is in flight the control starts no other (REQ-ACC-006).
    @Environment(TranAccountDeletion.self) private var deletion

    var body: some View {
        let stacked = dynamicTypeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: TranGap.md.value))
            : AnyLayout(HStackLayout(alignment: .center, spacing: TranGap.md.value))
        layout {
            titles.frame(maxWidth: .infinity, alignment: .leading)
            // One width for both buttons: the column's widest label, or the screen when stacked.
            TranStack(gap: .sm, alignment: .trailing) {
                TranButton(label: L10n.Common.signOut, variant: .secondary, size: .md, fullWidth: true) {
                    onSignOut()
                }
                .accessibilityIdentifier(signOutId)
                TranButton(label: L10n.Common.deleteAccount, variant: .danger, size: .md, fullWidth: true) {
                    onDeleteAccount()
                }
                .disabled(deletion.inFlight)
                .accessibilityIdentifier(deleteAccountId)
            }
            .fixedSize(horizontal: !stacked, vertical: false)
        }
    }
}
