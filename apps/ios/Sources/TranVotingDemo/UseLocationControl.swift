// Verifies: REQ-PRV-003 REQ-PRV-004 REQ-PRV-007 REQ-PSH-008
import SwiftUI

/// "Use my location" under the country field (spec 026).
struct UseLocationControl: View {
    let location: TranLocationPermission
    /// Filled with the country found; left alone when there is none.
    @Binding var countryCode: String

    var body: some View {
        PermissionControl(
            flow: location.flow,
            label: L10n.Eligibility.locationUse,
            primingTitle: TranLocationPermission.primingTitle,
            primingBody: TranLocationPermission.primingBody,
            settingsNote: TranLocationPermission.settingsNote,
            ids: .init(
                control: ScreenContract.Eligibility.useLocationButton,
                primingContinue: ScreenContract.Eligibility.locationPrimingContinue,
                primingDismiss: ScreenContract.Eligibility.locationPrimingDismiss,
                settingsNote: ScreenContract.Eligibility.locationSettingsNote,
                openSettings: ScreenContract.Eligibility.locationOpenSettings
            ),
            onTap: { run { await location.use() } },
            onContinue: { run { await location.continueAfterPriming() } },
            onNotNow: { location.notNow() },
            onOpenSettings: { location.openSettings() }
        )
    }

    private func run(_ step: @escaping @MainActor () async -> String?) {
        Task { @MainActor in
            if let code = await step() { countryCode = code }
        }
    }
}

/// "Notify me when I can vote" under a below-minimum verdict (spec 027, REQ-PSH-008).
struct NotifyMeControl: View {
    let notify: TranNotifyPermission

    var body: some View {
        PermissionControl(
            flow: notify.flow,
            label: L10n.Eligibility.notifyLabel,
            primingTitle: TranNotifyPermission.primingTitle,
            primingBody: TranNotifyPermission.primingBody,
            settingsNote: TranNotifyPermission.settingsNote,
            ids: .init(
                control: ScreenContract.Eligibility.notifyMeButton,
                primingContinue: ScreenContract.Eligibility.notifyPrimingContinue,
                primingDismiss: ScreenContract.Eligibility.notifyPrimingDismiss,
                settingsNote: ScreenContract.Eligibility.notifySettingsNote,
                openSettings: ScreenContract.Eligibility.notifyOpenSettings
            ),
            onTap: { Task { await notify.use() } },
            onContinue: { Task { await notify.continueAfterPriming() } },
            onNotNow: { notify.notNow() },
            onOpenSettings: { notify.openSettings() }
        )
    }
}

/// A permission control and its two inline states. The priming and the Settings note are in the
/// screen's flow rather than in a sheet or an alert, so they scroll and grow with the largest text
/// size like the rest of the form; their buttons stack full-width, so long hi/ne labels wrap
/// instead of being cut. `TranPermissionFlow` decides what shows; this only draws it.
struct PermissionControl: View {
    struct Ids {
        let control: String
        let primingContinue: String
        let primingDismiss: String
        let settingsNote: String
        let openSettings: String
    }

    let flow: TranPermissionFlow
    let label: String
    let primingTitle: String
    let primingBody: String
    let settingsNote: String
    let ids: Ids
    let onTap: () -> Void
    let onContinue: () -> Void
    let onNotNow: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        TranStack(gap: .sm, alignment: .leading) {
            TranButton(label: label, variant: .secondary, fullWidth: true, action: onTap)
                .disabled(flow.phase == .working)
                .accessibilityIdentifier(ids.control)

            switch flow.phase {
            case .priming:
                TranSurface(surface: .raised, radius: .sm, padding: .md) {
                    TranStack(gap: .sm, alignment: .leading) {
                        TranText(primingTitle, bold: true)
                        TranText(primingBody, variant: .muted)
                        TranButton(label: L10n.Common.continueAction, fullWidth: true, action: onContinue)
                            .accessibilityIdentifier(ids.primingContinue)
                        TranButton(label: L10n.Common.notNow, variant: .secondary, fullWidth: true, action: onNotNow)
                            .accessibilityIdentifier(ids.primingDismiss)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            case .settingsOffered:
                // A note, not an error: the feature's fallback still holds (REQ-PRV-004).
                TranText(settingsNote, variant: .muted)
                    .accessibilityIdentifier(ids.settingsNote)
                TranButton(label: L10n.Common.openSettings, variant: .secondary, fullWidth: true, action: onOpenSettings)
                    .accessibilityIdentifier(ids.openSettings)
            case .idle, .working:
                EmptyView()
            }
        }
    }
}
