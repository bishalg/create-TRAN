// Verifies: REQ-PRV-003 REQ-PRV-006 REQ-PSH-008
import CoreLocation
import Foundation
import MapKit

/// The only way the app talks to the operating system about a permission (ADR-0043 decision 6).
/// `SystemPermissionGateway` is the one real implementation; `FakePermissionGateway` stands in for
/// it in unit tests and UI tests, so no flow depends on a system dialog. What to do next is never
/// decided here: `permissionStep` (Rust, through UniFFI) does that from the status this reports.
@MainActor
protocol PermissionGateway: AnyObject {
    /// The current answer, mapped to the shared vocabulary. Reading it never shows a prompt. It is
    /// asynchronous because iOS reads the notification settings asynchronously.
    func status(of permission: TranPermissionId) async -> TranPermissionStatus

    /// Shows the system prompt (while-in-use, reduced accuracy for location; alerts, sounds and
    /// badges for notifications) and returns the person's answer. Called only after a tap and the
    /// priming's "Continue" (REQ-PRV-003, REQ-PSH-008).
    func request(_ permission: TranPermissionId) async -> TranPermissionStatus

    /// One approximate location reading, or `nil` when none comes (no permission, no signal).
    /// Never a stream, never in the background (REQ-PRV-006).
    func oneApproximateFix() async -> CLLocation?

    /// Opens this app's page in the Settings app, where a refusal can be changed.
    func openSettings()
}

/// Turns one location reading into a country, on the device (REQ-PRV-006).
protocol CountryResolver: Sendable {
    /// The ISO 3166-1 alpha-2 code of the country at `location`, or `nil` when it cannot tell.
    func countryCode(at location: CLLocation) async -> String?
}

/// MapKit's reverse geocoding (`MKReverseGeocodingRequest`, which replaced `CLGeocoder` in iOS
/// 26). It may use Apple's geocoding service; without an answer the feature falls back like a
/// refusal (ADR-0043, consequences). The coordinates go to no TRAN server and are not kept.
struct DeviceCountryResolver: CountryResolver {
    func countryCode(at location: CLLocation) async -> String? {
        guard let request = MKReverseGeocodingRequest(location: location) else { return nil }
        let items = try? await request.mapItems
        return items?.first?.addressRepresentations?.region?.identifier
    }
}

/// The snake-case names `fixtures/permissions.json` and the screen contract's `permission` given
/// use (`location_approximate`, `denied_permanently`).
extension TranPermissionId {
    static let all: [TranPermissionId] = [.locationApproximate, .notifications]

    var wire: String {
        switch self {
        case .locationApproximate: return "location_approximate"
        case .notifications: return "notifications"
        }
    }

    init?(wire: String) {
        guard let match = Self.all.first(where: { $0.wire == wire }) else { return nil }
        self = match
    }
}

extension TranPermissionStatus {
    static let all: [TranPermissionStatus] = [
        .notDetermined, .granted, .grantedApproximate, .denied, .deniedPermanently, .restricted,
    ]

    var wire: String {
        switch self {
        case .notDetermined: return "not_determined"
        case .granted: return "granted"
        case .grantedApproximate: return "granted_approximate"
        case .denied: return "denied"
        case .deniedPermanently: return "denied_permanently"
        case .restricted: return "restricted"
        }
    }

    init?(wire: String) {
        guard let match = Self.all.first(where: { $0.wire == wire }) else { return nil }
        self = match
    }
}
