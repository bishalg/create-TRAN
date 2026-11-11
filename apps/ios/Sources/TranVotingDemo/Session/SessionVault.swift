// Verifies: REQ-SEC-014 REQ-SEC-017 REQ-SEC-019 REQ-DB-011 REQ-DB-012
import Foundation

/// What the vault keeps for one API session: the refresh credential and whom it belongs to.
/// Never the access token, which lives in `TranSessionClient`'s memory only (REQ-SEC-017).
/// Carries a schema version; reading upgrades older records and discards newer ones (REQ-DB-011).
/// Printing or dumping one shows the token as `[redacted]` (REQ-SEC-014).
struct TranStoredSession: Equatable, Sendable, Codable {
    var schema: Int
    let refreshToken: String
    let userId: String
    /// The role's wire name (`citizen_voter`, `election_auditor`), as the API sends it.
    let roleWire: String

    init(
        schema: Int = Int(tranStoredSessionSchema()),
        refreshToken: String,
        userId: String,
        roleWire: String
    ) {
        self.schema = schema
        self.refreshToken = refreshToken
        self.userId = userId
        self.roleWire = roleWire
    }

    /// The role this session signs in as; `nil` for a name this build does not know.
    var role: TranUserRole? { TranUserRole(wire: roleWire) }

    private enum CodingKeys: String, CodingKey {
        case schema
        case refreshToken = "refresh_token"
        case userId = "user_id"
        case roleWire = "role"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schema = try container.decodeIfPresent(Int.self, forKey: .schema) ?? 1
        self.userId = try container.decode(String.self, forKey: .userId)
        self.roleWire = try container.decode(String.self, forKey: .roleWire)
        self.refreshToken = try container.decode(String.self, forKey: .refreshToken)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schema, forKey: .schema)
        try container.encode(userId, forKey: .userId)
        try container.encode(roleWire, forKey: .roleWire)
        try container.encode(refreshToken, forKey: .refreshToken)
    }
}

extension TranStoredSession: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    var description: String {
        "TranStoredSession(userId: \(userId), role: \(roleWire), refreshToken: [redacted])"
    }

    var debugDescription: String { description }

    var customMirror: Mirror {
        Mirror(self, children: ["userId": userId, "role": roleWire, "refreshToken": "[redacted]"])
    }
}

extension TranUserRole {
    /// The API's name for the role (`docs/API.md`, sessions).
    var wire: String {
        switch self {
        case .citizenVoter: return "citizen_voter"
        case .electionAuditor: return "election_auditor"
        }
    }

    init?(wire: String) {
        switch wire {
        case "citizen_voter": self = .citizenVoter
        case "election_auditor": self = .electionAuditor
        default: return nil
        }
    }
}

/// The one place iOS persists a session (REQ-SEC-019): `KeychainSessionVault` in the app,
/// `InMemorySessionVault` in unit tests and under a debug launch preset (ADR-0039).
protocol SessionVault: Sendable {
    /// The stored session, or `nil` when there is none or it cannot be read.
    func load() -> TranStoredSession?
    /// Replaces whatever was stored.
    func save(_ session: TranStoredSession) throws
    /// Deletes the stored session; safe to repeat.
    func clear()
}

/// A vault that forgets everything when the process ends. Thread-safe, so a test can read it
/// from a stubbed transport while the client works.
final class InMemorySessionVault: SessionVault, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: TranStoredSession?

    init(_ stored: TranStoredSession? = nil) {
        self.stored = stored
    }

    func load() -> TranStoredSession? {
        lock.withLock { stored }
    }

    func save(_ session: TranStoredSession) throws {
        lock.withLock { stored = session }
    }

    func clear() {
        lock.withLock { stored = nil }
    }
}
