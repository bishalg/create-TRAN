// Verifies: REQ-PSH-008 REQ-PRV-003 REQ-PRV-004
import Foundation
import Observation

/// "Notify me when I can vote" (spec 027, REQ-PSH-008): offered with a below-minimum verdict in a
/// build with push, and asked through `TranPermissionFlow` like every permission: the priming
/// first, the system prompt only after "Continue", a refusal that changes nothing, and the Settings
/// note after a permanent one. Once permission is there it asks the push gateway for a token; the
/// registration itself is `TranPushRegistration`'s, run when the token arrives.
@MainActor
@Observable
final class TranNotifyPermission {
    typealias Phase = TranPermissionFlow.Phase

    static let permission = TranPermissionId.notifications

    let flow: TranPermissionFlow
    @ObservationIgnored private let push: PushGateway

    init(gateway: PermissionGateway, push: PushGateway) {
        self.flow = TranPermissionFlow(Self.permission, gateway: gateway)
        self.push = push
    }

    var phase: Phase { flow.phase }

    /// Whether the control may appear at all: never in a build without push (REQ-PSH-012).
    var isOffered: Bool { push.isAvailable }

    /// The catalogue's entry: its copy keys and its fallback (REQ-PRV-001).
    static var entry: TranPermission { permissionEntry(id: permission) }

    // MARK: - Copy from the catalogue's keys

    static var primingTitle: String { copy(entry.primingTitleKey) }
    static var primingBody: String { copy(entry.primingBodyKey) }
    static var settingsNote: String { copy(entry.settingsNoteKey) }

    /// Localized copy for a key the notifications entry names; a unit test asks for every one.
    static func localized(_ key: String) -> String? {
        switch key {
        case "eligibility.notify.primingTitle": return L10n.Eligibility.notifyPrimingTitle
        case "eligibility.notify.primingBody": return L10n.Eligibility.notifyPrimingBody
        case "eligibility.notify.purpose": return L10n.Eligibility.notifyPurpose
        case "eligibility.notify.settingsNote": return L10n.Eligibility.notifySettingsNote
        default: return nil
        }
    }

    private static func copy(_ key: String) -> String { localized(key) ?? key }

    // MARK: - What the person does

    /// The tap on the control.
    func use() async {
        guard isOffered, await flow.tap() else { return }
        push.registerForPush()
    }

    /// "Continue" on the priming: now, and only now, the system may ask.
    func continueAfterPriming() async {
        guard await flow.continueAfterPriming() else { return }
        push.registerForPush()
    }

    /// "Not now" on the priming: nothing was asked, so nothing was refused.
    func notNow() {
        flow.notNow()
    }

    /// "Open Settings" under the note.
    func openSettings() {
        flow.openSettings()
    }
}
