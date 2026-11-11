// Verifies: REQ-PSH-009 REQ-PSH-010 REQ-DB-011 REQ-DB-012
import Foundation

/// What push keeps on the device, in ordinary app storage (`UserDefaults`): the installation id and
/// the registration the API last accepted. Neither is a credential (spec 027): the installation id
/// is a random UUID that only tells installs apart, and the token is an address, not a secret, so
/// neither belongs in the Keychain. The storage guard test allows this file's writes by name.
///
/// `UserDefaults` is part of a backup and of a device-to-device transfer, and iOS offers no way to
/// leave one key out. So the id is bound to the push token of the device that created it: a token
/// is issued per device and per install, and when the system hands this install a token that is
/// not the one the id was bound to (a restore or a transfer onto another phone, a reinstall), the
/// id is replaced before anything is registered (REQ-PSH-010). Two devices therefore never
/// register under one id. A token the same device rotates also gets a fresh id; the registration
/// under the old one holds a dead token, which the API removes on the provider's answer or after
/// 60 days (REQ-PSH-005).
struct TranPushStore {
    static let installationKey = "TranInstallationId"
    static let boundTokenKey = "TranInstallationToken"
    static let schemaKey = "TranPushSchema"
    static let tokenKey = "TranPushRegisteredToken"
    static let registeredAtKey = "TranPushRegisteredAt"

    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The installation id, created with the platform's random UUID on first use and kept until
    /// the app is deleted (REQ-PSH-010). Never derived from hardware; sent only on the device
    /// routes; never logged.
    var installationId: String {
        if let kept = defaults.string(forKey: Self.installationKey), UUID(uuidString: kept) != nil {
            return kept
        }
        let created = UUID().uuidString.lowercased()
        defaults.set(created, forKey: Self.installationKey)
        return created
    }

    /// Binds the installation id to the token this device delivered. A different token from the one
    /// it was bound to means another device or install: the id and the recorded registration are
    /// replaced. Returns whether the id changed.
    @discardableResult
    func bind(token: String) -> Bool {
        let bound = defaults.string(forKey: Self.boundTokenKey)
        guard bound != token else { return false }
        defaults.set(token, forKey: Self.boundTokenKey)
        guard bound != nil else { return false }
        defaults.set(UUID().uuidString.lowercased(), forKey: Self.installationKey)
        clear()
        return true
    }

    /// The registration the API answered `204` to, or `nil` (REQ-DB-011). An older version is read
    /// as it is; a newer one is left for the app version that wrote it; an unreadable one (a
    /// mistyped value, an invalid `schema`) is cleared. Reading never writes.
    var lastRegistration: TranLastRegistration? {
        let keys = [Self.schemaKey, Self.tokenKey, Self.registeredAtKey]
        guard keys.contains(where: { defaults.object(forKey: $0) != nil }) else { return nil }
        switch TranStoredSchema.verdict(defaults.object(forKey: Self.schemaKey), current: tranStoredPushSchema()) {
        case .newer: return nil
        case .unreadable:
            clear()
            return nil
        case .use: break
        }
        guard let token = defaults.object(forKey: Self.tokenKey) as? String,
            let at = defaults.object(forKey: Self.registeredAtKey) as? NSNumber,
            CFGetTypeID(at) != CFBooleanGetTypeID(), !CFNumberIsFloatType(at)
        else {
            clear()
            return nil
        }
        return TranLastRegistration(token: token, registeredAtUnixS: at.int64Value)
    }

    func record(_ registration: TranLastRegistration) {
        defaults.set(Int(tranStoredPushSchema()), forKey: Self.schemaKey)
        defaults.set(registration.token, forKey: Self.tokenKey)
        defaults.set(NSNumber(value: registration.registeredAtUnixS), forKey: Self.registeredAtKey)
    }

    func clear() {
        defaults.removeObject(forKey: Self.schemaKey)
        defaults.removeObject(forKey: Self.tokenKey)
        defaults.removeObject(forKey: Self.registeredAtKey)
    }
}
