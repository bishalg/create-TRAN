// Verifies: REQ-VER-001 REQ-VER-003
import Foundation

/// Every request the iOS app makes, by the name `fixtures/contract/clients/ios/current.json` gives
/// it (REQ-VER-003). Paths are built on the generated `ApiContract.basePath` and `healthPath`, never
/// spelled with a version (REQ-VER-001). `TranHttp` builds a request only from a case of this enum,
/// so `ClientManifestTests` can hold the manifest to it: a new call is a new case, and a new case
/// without a manifest entry fails.
enum TranEndpoint: String, CaseIterable, Sendable {
    case checkHealth
    case confirmEligibility
    case signIn
    case refresh
    case signOut
    case validateSession
    case deleteAccount
    case registerDevice
    case unregisterDevice

    /// What `{installation_id}` stands for in a device path, as the manifest spells it.
    static let installationIdPlaceholder = "{installation_id}"

    var method: String {
        switch self {
        case .checkHealth, .validateSession: return "GET"
        case .confirmEligibility, .signIn, .refresh, .signOut: return "POST"
        case .deleteAccount, .unregisterDevice: return "DELETE"
        case .registerDevice: return "PUT"
        }
    }

    /// The path, with `{installation_id}` where a device path takes the installation id.
    var template: String {
        switch self {
        case .checkHealth: return ApiContract.healthPath
        case .confirmEligibility: return ApiContract.basePath + "/vote/eligibility"
        case .signIn, .validateSession: return ApiContract.basePath + "/auth/session"
        case .refresh: return ApiContract.basePath + "/auth/refresh"
        case .signOut: return ApiContract.basePath + "/auth/sign-out"
        case .deleteAccount: return ApiContract.basePath + "/account"
        case .registerDevice, .unregisterDevice:
            return ApiContract.basePath + "/devices/" + Self.installationIdPlaceholder
        }
    }

    /// The concrete path: `installationId` fills a device path's placeholder.
    func path(installationId: String? = nil) -> String {
        guard let installationId else { return template }
        return template.replacingOccurrences(of: Self.installationIdPlaceholder, with: installationId)
    }
}
