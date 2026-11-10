// Verifies: REQ-SEC-019 REQ-SEC-021
import Foundation

/// What the Splash does before any network call (REQ-SEC-021): read the vault and let the Rust
/// navigation director pick the screen (`AuthSession.destination`). Validation happens later, in
/// the background (`TranSessionClient.validate()`).
enum TranSessionLaunch {
    /// "This install has launched before". Only a flag: no credential ever goes to `UserDefaults`.
    static let launchedKey = "TranHasLaunched"

    /// A Keychain item outlives the app that wrote it, so the first launch after an install deletes
    /// whatever a previous install left behind (REQ-SEC-019).
    static func wipeLeftoversOnFirstLaunch(vault: SessionVault, defaults: UserDefaults = .standard) {
        guard !defaults.bool(forKey: launchedKey) else { return }
        vault.clear()
        defaults.set(true, forKey: launchedKey)
    }

    /// The device session the vault holds, and the stored record to validate in the background. A
    /// record whose role this build does not know is deleted and treated as signed out.
    static func restore(
        vault: SessionVault,
        defaults: UserDefaults = .standard
    ) -> (session: AuthSession, stored: TranStoredSession?) {
        wipeLeftoversOnFirstLaunch(vault: vault, defaults: defaults)
        guard let stored = vault.load() else { return (.unauthenticated, nil) }
        guard let role = stored.role else {
            vault.clear()
            return (.unauthenticated, nil)
        }
        return (.authenticated(role: role), stored)
    }
}
