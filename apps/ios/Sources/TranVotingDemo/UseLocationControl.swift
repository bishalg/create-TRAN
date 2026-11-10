// Verifies: REQ-PRV-003 REQ-PRV-004 REQ-PRV-007
import SwiftUI

/// "Use my location" under the country field (spec 026). The priming and the Settings note are
/// inline, in the screen's flow rather than in a sheet or an alert, so they scroll and grow with
/// the largest text size like the rest of the form; their buttons stack full-width, so long hi/ne
/// labels wrap instead of being cut. `TranLocationPermission` decides what shows; this only draws it.
struct UseLocationControl: View {
    let location: TranLocationPermission
    /// Filled with the country found; left alone when there is none.
    @Binding var countryCode: String

    var body: some View {
        TranStack(gap: .sm, alignment: .leading) {
            TranButton(label: L10n.Eligibility.locationUse, variant: .secondary, fullWidth: true) {
                run { await location.use() }
            }
            .disabled(location.phase == .working)
            .accessibilityIdentifier(ScreenContract.Eligibility.useLocationButton)

            switch location.phase {
            case .priming:
                TranSurface(surface: .raised, radius: .sm, padding: .md) {
                    TranStack(gap: .sm, alignment: .leading) {
                        TranText(TranLocationPermission.primingTitle, bold: true)
                        TranText(TranLocationPermission.primingBody, variant: .muted)
                        TranButton(label: L10n.Common.continueAction, fullWidth: true) {
                            run { await location.continueAfterPriming() }
                        }
                        .accessibilityIdentifier(ScreenContract.Eligibility.locationPrimingContinue)
                        TranButton(label: L10n.Common.notNow, variant: .secondary, fullWidth: true) {
                            location.notNow()
                        }
                        .accessibilityIdentifier(ScreenContract.Eligibility.locationPrimingDismiss)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            case .settingsOffered:
                // A note, not an error: the country can still be typed (REQ-PRV-004).
                TranText(TranLocationPermission.settingsNote, variant: .muted)
                    .accessibilityIdentifier(ScreenContract.Eligibility.locationSettingsNote)
                TranButton(label: L10n.Common.openSettings, variant: .secondary, fullWidth: true) {
                    location.openSettings()
                }
                .accessibilityIdentifier(ScreenContract.Eligibility.locationOpenSettings)
            case .idle, .working:
                EmptyView()
            }
        }
    }

    private func run(_ step: @escaping @MainActor () async -> String?) {
        Task { @MainActor in
            if let code = await step() { countryCode = code }
        }
    }
}
