// Verifies: REQ-PRV-003 REQ-PRV-004 REQ-PSH-008
import Foundation
import Observation

/// The steps every permission control follows (spec 026, ADR-0043), whatever the feature behind
/// it: `permissionStep`, the Rust decision, picks each move from the status the gateway reports.
/// Nothing asks the system before the person taps the control and then chooses "Continue" on the
/// priming; a fresh refusal changes nothing and shows no error; after a permanent refusal the next
/// tap says once, inline, where the setting is. `TranLocationPermission` and
/// `TranNotifyPermission` add only what their feature does once permission is there.
@MainActor
@Observable
final class TranPermissionFlow {
    enum Phase: Equatable {
        /// The control alone.
        case idle
        /// The app's own explanation, with "Continue" and "Not now".
        case priming
        /// Waiting for the system prompt's answer or the feature; the control is disabled.
        case working
        /// The inline note that the setting lives in Settings, with "Open Settings".
        case settingsOffered
    }

    let permission: TranPermissionId
    private(set) var phase: Phase = .idle
    @ObservationIgnored private let gateway: PermissionGateway

    init(_ permission: TranPermissionId, gateway: PermissionGateway) {
        self.permission = permission
        self.gateway = gateway
    }

    /// The catalogue's entry: its copy keys and its fallback (REQ-PRV-001).
    var entry: TranPermission { permissionEntry(id: permission) }

    /// The tap on the control. `true` when the feature may run now; `false` when the priming or
    /// the Settings note is showing, or the person said no.
    func tap() async -> Bool {
        guard phase != .working else { return false }
        return await follow(permissionStep(status: await gateway.status(of: permission), primed: false))
    }

    /// "Continue" on the priming: now, and only now, the system may ask.
    func continueAfterPriming() async -> Bool {
        guard phase == .priming else { return false }
        phase = .idle
        return await follow(permissionStep(status: await gateway.status(of: permission), primed: true))
    }

    /// "Not now" on the priming: nothing was asked, so nothing was refused.
    func notNow() {
        if phase == .priming { phase = .idle }
    }

    /// "Open Settings" under the note.
    func openSettings() {
        gateway.openSettings()
    }

    /// Runs the feature with the control disabled, then returns to the control alone.
    func working<T>(_ feature: () async -> T) async -> T {
        phase = .working
        defer { phase = .idle }
        return await feature()
    }

    private func follow(_ step: TranPermissionStep) async -> Bool {
        switch step {
        case .showPriming:
            phase = .priming
            return false
        case .offerSettings:
            phase = .settingsOffered
            return false
        case .useFeature:
            return true
        case .requestSystem:
            phase = .working
            let answer = await gateway.request(permission)
            phase = .idle
            // A fresh refusal falls back quietly (the catalogue's fallback): the person has just
            // said no, so the Settings note waits for their next tap rather than nagging now.
            return permissionStep(status: answer, primed: true) == .useFeature
        }
    }
}
