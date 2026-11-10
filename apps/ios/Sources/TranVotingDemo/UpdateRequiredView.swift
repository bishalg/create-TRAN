// Verifies: REQ-VER-009 REQ-VER-011
import SwiftUI

/// The `screen` presentation of `client.upgrade_required` (REQ-VER-009): the API no longer serves
/// this version. It replaces everything, has no way back and keeps the session; its one action
/// opens the store page from the build configuration (`TranStoreLink`, REQ-VER-011). Atoms only;
/// it scrolls, so it fits the largest text size.
struct UpdateRequiredView: View {
    @Environment(\.openURL) private var openURL

    /// The catalogue's title for the code; `codegen` guarantees the string exists.
    private static let title = TranFeedback.message(errorSpec(code: .clientUpgradeRequired).messageKey)

    var body: some View {
        TranScreen {
            ScrollView {
                TranBox(padding: .lg) {
                    TranStack(gap: .md, alignment: .leading) {
                        TranText(Self.title, variant: .title)
                            .accessibilityAddTraits(.isHeader)
                        TranText(L10n.Errors.updateRequiredBody)
                        TranButton(label: L10n.Common.update, fullWidth: true) {
                            openURL(TranStoreLink.url())
                        }
                        .accessibilityIdentifier(ScreenContract.Eligibility.updateButton)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        // VoiceOver starts on the new screen, as the web moves focus to its heading.
        .onAppear { AccessibilityNotification.ScreenChanged(nil).post() }
    }
}
