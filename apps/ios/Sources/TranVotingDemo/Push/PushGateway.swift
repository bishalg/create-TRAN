// Verifies: REQ-PSH-008 REQ-PSH-012
import Foundation

/// What the system told the push gateway.
enum TranPushEvent: Equatable, Sendable {
    /// A new token arrived (`PushGateway.token` holds it): time to run the sync (REQ-PSH-009).
    case tokenArrived
    /// The person opened the app from a notification (REQ-PSH-013).
    case opened
    /// A notification arrived while the app was in the foreground (REQ-PSH-013).
    case arrivedInForeground
}

/// The only way the app talks to the operating system about push (spec 027, ADR-0044).
/// `SystemPushGateway` is the one real implementation and the only file that registers for remote
/// notifications or is the notification center's delegate (`push-guards.test.ts`);
/// `FakePushGateway` stands in for it in unit tests and UI tests. The notification *permission* is
/// a `PermissionGateway` matter, asked like every other permission. What to do with a token is
/// never decided here: `pushSync` (Rust, through UniFFI) does that (`TranPushRegistration`).
@MainActor
protocol PushGateway: AnyObject {
    /// Whether this build is configured for push (REQ-PSH-012): the `TRAN_PUSH_ENABLED` build
    /// setting, which also adds the `aps-environment` entitlement. Without it the app never asks
    /// for a token and the "Notify me" control is not shown.
    var isAvailable: Bool { get }

    /// The token the system last delivered, as lowercase hex; `nil` until it delivers one. Held in
    /// memory only: the system delivers it again on every launch that asks.
    var token: String? { get }

    /// Asks the system for a token (granted permission only). It arrives later, as `.tokenArrived`.
    func registerForPush()

    /// Where the gateway reports what the system did. An event that comes before anyone listens
    /// (a tap that launched the app) is kept and delivered when this is set.
    var onEvent: ((TranPushEvent) -> Void)? { get set }
}

/// The installation's push environment and the values its registration carries (`docs/API.md`).
struct TranPushBuild: Equatable, Sendable {
    static let enabledKey = "TranPushEnabled"
    static let environmentKey = "TranApsEnvironment"

    /// `TRAN_PUSH_ENABLED` as the build expanded it into Info.plist.
    let enabled: Bool
    /// `sandbox` for a development build, `production` for a release build: the APNs environment
    /// the `aps-environment` entitlement names (`TRAN_APS_ENVIRONMENT`).
    let environment: String

    /// Reads the two Info.plist values; anything but `YES` is off.
    static func from(info: [String: Any]?) -> TranPushBuild {
        let enabled = (info?[enabledKey] as? String)?.uppercased() == "YES"
        let environment = (info?[environmentKey] as? String) == "production" ? "production" : "sandbox"
        return TranPushBuild(enabled: enabled, environment: environment)
    }

    static let current = from(info: Bundle.main.infoDictionary)
}

/// Which push gateway the app uses. A release build always uses the system's. A debug build
/// launched with a UI test preset (`-TranSession`, `-TranPermission`) uses the fake, so no test can
/// reach APNs: push is available there only when the `permission` given names `notifications`
/// (`-TranPermission notifications=granted`), and then a granted permission yields `fakeToken`
/// (REQ-PSH-008, `docs/PUSH.md`). A debug run from Xcode with neither uses the system's.
enum TranPushLaunch {
    /// A fixed, well-formed APNs token (64 hex characters) for the fake.
    static let fakeToken = String(repeating: "0f", count: 32)

    @MainActor static let shared: PushGateway = gateway()

    @MainActor static func gateway(defaults: UserDefaults = .standard) -> PushGateway {
        #if DEBUG
            let preset = defaults.string(forKey: TranPermissionLaunch.presetKey)
            if preset != nil || defaults.string(forKey: AuthSession.launchPresetKey) != nil {
                let staged = TranPermissionLaunch.statuses(preset ?? "")[.notifications] != nil
                return FakePushGateway(available: staged, tokenOnRegister: staged ? fakeToken : nil)
            }
        #endif
        return SystemPushGateway.shared
    }
}
