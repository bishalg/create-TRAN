// Verifies: REQ-PRV-002 REQ-PRV-003 REQ-PRV-004 REQ-PRV-006
import CoreLocation
import Foundation
import Observation

/// "Use my location" on the eligibility screen (spec 026, ADR-0043): every move follows
/// `permissionStep`, the Rust decision, from the status the gateway reports. Nothing asks the
/// system before the person taps the control and then chooses "Continue" on the priming; a refusal
/// leaves the country as typed and shows no error; after a permanent refusal the control says once,
/// inline, where the setting is. The one reading becomes a country code on the device and is then
/// dropped: this type keeps no location, and logs and sends nothing (REQ-PRV-006).
@MainActor
@Observable
final class TranLocationPermission {
    enum Phase: Equatable {
        /// The control alone.
        case idle
        /// The app's own explanation, with "Continue" and "Not now".
        case priming
        /// Waiting for the system prompt's answer or the reading; the control is disabled.
        case working
        /// The inline note that the setting lives in Settings, with "Open Settings".
        case settingsOffered
    }

    static let permission = TranPermissionId.locationApproximate

    private(set) var phase: Phase = .idle
    @ObservationIgnored private let gateway: PermissionGateway
    @ObservationIgnored private let resolver: CountryResolver

    init(gateway: PermissionGateway, resolver: CountryResolver = DeviceCountryResolver()) {
        self.gateway = gateway
        self.resolver = resolver
    }

    /// The catalogue's entry: its copy keys and its fallback (REQ-PRV-001).
    static var entry: TranPermission { permissionEntry(id: permission) }

    // MARK: - Copy from the catalogue's keys

    static var primingTitle: String { copy(entry.primingTitleKey) }
    static var primingBody: String { copy(entry.primingBodyKey) }
    static var settingsNote: String { copy(entry.settingsNoteKey) }

    /// Localized copy for a key the location entry names; `copy(_:) != nil` for every one of them
    /// is a unit test, so a renamed key fails there rather than on screen.
    static func localized(_ key: String) -> String? {
        switch key {
        case "eligibility.location.primingTitle": return L10n.Eligibility.locationPrimingTitle
        case "eligibility.location.primingBody": return L10n.Eligibility.locationPrimingBody
        case "eligibility.location.purpose": return L10n.Eligibility.locationPurpose
        case "eligibility.location.settingsNote": return L10n.Eligibility.locationSettingsNote
        default: return nil
        }
    }

    private static func copy(_ key: String) -> String { localized(key) ?? key }

    // MARK: - What the person does

    /// The tap on the "Use my location" control. Returns the country found, or `nil` when the country
    /// stays as typed: the priming or the Settings note is showing, or there was no answer.
    func use() async -> String? {
        guard phase != .working else { return nil }
        return await follow(permissionStep(status: gateway.status(of: Self.permission), primed: false))
    }

    /// "Continue" on the priming: now, and only now, the system may ask.
    func continueAfterPriming() async -> String? {
        guard phase == .priming else { return nil }
        phase = .idle
        return await follow(permissionStep(status: gateway.status(of: Self.permission), primed: true))
    }

    /// "Not now" on the priming: nothing was asked, so nothing was refused.
    func notNow() {
        if phase == .priming { phase = .idle }
    }

    /// "Open Settings" under the note.
    func openSettings() {
        gateway.openSettings()
    }

    // MARK: - The steps

    private func follow(_ step: TranPermissionStep) async -> String? {
        switch step {
        case .showPriming:
            phase = .priming
            return nil
        case .offerSettings:
            phase = .settingsOffered
            return nil
        case .useFeature:
            return await locate()
        case .requestSystem:
            phase = .working
            let answer = await gateway.request(Self.permission)
            // A fresh refusal falls back quietly (`keep_manual_entry`): the person has just said
            // no, so the Settings note waits for their next tap rather than nagging now.
            guard permissionStep(status: answer, primed: true) == .useFeature else {
                phase = .idle
                return nil
            }
            return await locate()
        }
    }

    /// One reading, turned into a country code and dropped. No reading or no country: the
    /// catalogue's fallback, the country stays as typed.
    private func locate() async -> String? {
        phase = .working
        defer { phase = .idle }
        guard let fix = await gateway.oneApproximateFix() else { return nil }
        guard let code = await resolver.countryCode(at: fix), !code.isEmpty else { return nil }
        return code.uppercased()
    }
}

/// Which gateway the app uses. A release build always asks iOS. A debug build launched with a UI
/// test preset (`-TranSession`, `-TranPermission`) uses the fake, so no UI test can meet a real
/// system prompt; `-TranPermission location_approximate=denied_permanently` stages a status, as the
/// screen contract's `permission` given does (REQ-PRV-007). A debug run from Xcode with neither
/// asks iOS, so the real prompt can be tried by hand.
enum TranPermissionLaunch {
    static let presetKey = "TranPermission"

    @MainActor static let shared: PermissionGateway = gateway()

    @MainActor static func gateway(defaults: UserDefaults = .standard) -> PermissionGateway {
        #if DEBUG
            let preset = defaults.string(forKey: presetKey)
            if preset != nil || defaults.string(forKey: AuthSession.launchPresetKey) != nil {
                return FakePermissionGateway(statuses(preset ?? ""))
            }
        #endif
        return SystemPermissionGateway()
    }

    /// `location_approximate=denied_permanently[,…]` → statuses; unknown names are ignored.
    static func statuses(_ preset: String) -> [TranPermissionId: TranPermissionStatus] {
        var statuses: [TranPermissionId: TranPermissionStatus] = [:]
        for pair in preset.split(separator: ",") {
            let parts = pair.split(separator: "=", maxSplits: 1).map {
                $0.trimmingCharacters(in: .whitespaces)
            }
            guard parts.count == 2, let id = TranPermissionId(wire: parts[0]),
                let status = TranPermissionStatus(wire: parts[1])
            else { continue }
            statuses[id] = status
        }
        return statuses
    }
}
