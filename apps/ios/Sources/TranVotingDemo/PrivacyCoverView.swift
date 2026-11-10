import SwiftUI

/// The window cover for the app switcher (REQ-SEC-023): the palette background and the brand
/// mark, no text and no user data. Hidden from VoiceOver; it only shows while the scene is not
/// active. `TranPrivacyCover.covers` decides when.
struct PrivacyCoverView: View {
    @Environment(\.tranPalette) private var palette

    var body: some View {
        TranScreen {
            Image(systemName: "hand.raised.fill")
                .font(.largeTitle)
                .foregroundStyle(palette.primary)
        }
        .accessibilityHidden(true)
    }
}
