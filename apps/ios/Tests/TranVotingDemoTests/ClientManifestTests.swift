// Verifies: REQ-VER-001 REQ-VER-003 REQ-VER-004
import XCTest

/// `fixtures/contract/clients/ios/current.json` is what the iOS app sends and reads, and it cannot
/// drift from the code (REQ-VER-003). Three holds, together:
/// - the app builds a request in one place (`TranHttp.request`) and only from a `TranEndpoint`, and
///   no other file names a path (source scan below; `versioning-guards.test.ts` bans literals);
/// - every case of `TranEndpoint` is one manifest entry, and every public call of the API client,
///   the session client and the push registration runs here on a recording transport: what it
///   sent (method, path, `X-Tran-Client`, bearer or refresh token, body) must equal its entry, and
///   a request no entry lists fails;
/// - `reads` equals the fields the app's decoders ask for, found by decoding with a probe.
/// `pnpm release` copies the manifest to `<version>.json`; `client_replay_test.rs` replays both.
@MainActor
final class ClientManifestTests: XCTestCase {
    private struct Entry: Decodable {
        let name: String
        let method: String
        let path: String
        let auth: String?
        let headers: [String: String]
        let body: AnyJSON?
        let status: Int
        let reads: [String: String]
    }

    private struct Manifest: Decodable {
        let platform: String
        let version: String
        let requests: [Entry]
    }

    private static let version = "9.9.9"
    private static let pushToken = String(repeating: "a1", count: 32)

    private func manifest() throws -> Manifest {
        let url = RepoFixtures.root.appendingPathComponent("fixtures/contract/clients/ios/current.json")
        return try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url))
    }

    // MARK: - One entry per endpoint

    func testTheManifestListsEveryEndpointOnceAsTheAppBuildsIt() throws {
        let manifest = try manifest()
        XCTAssertEqual(manifest.platform, "ios")
        XCTAssertEqual(manifest.version, "{version}")
        XCTAssertEqual(manifest.requests.map(\.name), TranEndpoint.allCases.map(\.rawValue))
        for (entry, endpoint) in zip(manifest.requests, TranEndpoint.allCases) {
            XCTAssertEqual(entry.method, endpoint.method, entry.name)
            XCTAssertEqual(entry.path, endpoint.template, entry.name)
            XCTAssertEqual(entry.headers, [ApiContract.clientHeader: "ios/{version}"], entry.name)
        }
    }

    // MARK: - What each call sends

    func testEachCallSendsWhatItsEntrySays() async throws {
        let entries = Dictionary(uniqueKeysWithValues: try manifest().requests.map { ($0.name, $0) })
        for (name, sent) in try await record() {
            let entry = try XCTUnwrap(entries[name], "\(name): a request the manifest does not list")
            XCTAssertEqual(sent.method, entry.method, name)
            XCTAssertEqual(sent.template, entry.path, name)
            XCTAssertEqual(sent.client, "ios/\(Self.version)", name)
            XCTAssertEqual(sent.authorization != nil, entry.auth == "bearer", "\(name): bearer")
            let expected = entry.body?.filled(version: Self.version, refreshToken: sent.refreshToken)
            XCTAssertEqual(sent.body, expected, "\(name): body")
            XCTAssertEqual(entry.auth == "refresh_token", sent.refreshToken != nil, "\(name): refresh token")
        }
    }

    /// One sent request, by the endpoint it stands for.
    private struct Sent {
        let method: String
        let template: String
        let client: String?
        let authorization: String?
        let body: AnyJSON?
        /// The vault's refresh token, when the body carried it.
        let refreshToken: String?
    }

    /// Runs every public call once on a recording transport; returns what each sent, by name.
    /// Each request must stand for an endpoint: anything else fails here.
    private func record() async throws -> [String: Sent] {
        // Each answer as the API gives it; bodies the app does not read are empty objects.
        SessionStubProtocol.reset { request in
            let pair = SessionWire.pair(access: "access-1", refresh: "refresh-1")
            if request.method == "POST", request.path == TranEndpoint.signIn.path() { return .status(201, body: pair) }
            if request.path == TranEndpoint.refresh.path() { return .status(200, body: pair) }
            if request.method == "GET" || request.path == TranEndpoint.confirmEligibility.path() {
                return .status(200, body: "{}")
            }
            return .status(204, body: "")
        }
        let base = URL(string: "http://127.0.0.1:3001")!
        let client = "ios/\(Self.version)"
        let api = TranApiClient(
            baseUrl: base, session: SessionStubProtocol.session(), includeDebugCountry: false,
            retry: TranRetry(sleep: { _ in }, random: { 0 }), client: client, onStanding: { _ in })
        func session(_ vault: SessionVault) -> TranSessionClient {
            TranSessionClient(
                vault: vault, baseUrl: base, session: SessionStubProtocol.session(), log: { _ in },
                client: client, onStanding: { _ in })
        }
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "ClientManifestTests"))
        defaults.removePersistentDomain(forName: "ClientManifestTests")
        defer { defaults.removePersistentDomain(forName: "ClientManifestTests") }
        let store = TranPushStore(defaults: defaults)

        var calls: [(String, () async throws -> Void)] = [
            ("checkHealth", { try await api.checkHealth() }),
            ("confirmEligibility", { try await api.confirmEligibility(age: 20, countryCode: "NP") }),
            ("signIn", { try await session(InMemorySessionVault()).signIn(role: .citizenVoter) }),
            // A restored session refreshes before its first call; the call itself is `validateSession`.
            ("refresh", { _ = try await session(InMemorySessionVault(SessionWire.stored())).authorized(.validateSession) }),
            ("signOut", { await session(InMemorySessionVault(SessionWire.stored())).signOut() }),
        ]
        let signedIn = session(InMemorySessionVault())
        calls += [
            ("validateSession", {
                try await signedIn.signIn(role: .citizenVoter)
                _ = await signedIn.validate()
            }),
            ("deleteAccount", {
                try await signedIn.signIn(role: .citizenVoter)
                try await signedIn.deleteAccount()
            }),
        ]
        let push = TranPushRegistration(
            gateway: FakePushGateway(available: true, tokenOnRegister: Self.pushToken),
            permissions: FakePermissionGateway([.notifications: .granted]),
            client: session(InMemorySessionVault(SessionWire.stored())),
            store: store,
            app: .init(environment: "sandbox", locale: "en", version: Self.version),
            log: { _ in })
        calls += [
            ("registerDevice", { _ = await push.sync() }),
            ("unregisterDevice", { await push.signOut() }),
        ]

        let listed = Set(try manifest().requests.map(\.name))
        var sent: [String: Sent] = [:]
        for (name, call) in calls {
            let before = SessionStubProtocol.requests.count
            try await call()
            let requests = SessionStubProtocol.requests.dropFirst(before)
            for request in requests {
                let endpoint = try XCTUnwrap(
                    endpoint(of: request, installationId: store.installationId),
                    "\(name) sent \(request.method) \(request.path), which no endpoint stands for")
                XCTAssertTrue(listed.contains(endpoint.rawValue), "\(endpoint.rawValue): a request the manifest does not list")
                XCTAssertEqual(request.client, client, "\(name): every request names the client")
            }
            // The call's own request is the last one it sent (a refresh may come first).
            let own = try XCTUnwrap(
                requests.last { endpoint(of: $0, installationId: store.installationId)?.rawValue == name },
                "\(name) sent no \(name) request")
            let body = own.raw.isEmpty ? nil : try JSONDecoder().decode(AnyJSON.self, from: own.raw)
            sent[name] = Sent(
                method: own.method,
                template: own.path.replacingOccurrences(
                    of: store.installationId, with: TranEndpoint.installationIdPlaceholder),
                client: own.client,
                authorization: own.authorization,
                body: body,
                refreshToken: own.body["refresh_token"])
        }
        XCTAssertEqual(Set(sent.keys), Set(TranEndpoint.allCases.map(\.rawValue)), "every endpoint was called")
        return sent
    }

    /// The endpoint a recorded request stands for, by method and path.
    private func endpoint(of request: SessionStubProtocol.Recorded, installationId: String) -> TranEndpoint? {
        TranEndpoint.allCases.first {
            $0.method == request.method && $0.path(installationId: installationId) == request.path
        }
    }

    // MARK: - What each call reads

    func testReadsAreTheFieldsTheAppDecodes() throws {
        let decoded: [String: [String: String]] = [
            "signIn": try ReadProbe.reads(TranSessionClient.TokenPair.self),
            "refresh": try ReadProbe.reads(TranSessionClient.TokenPair.self),
        ]
        XCTAssertEqual(decoded["signIn"]?["user.role"], "string", "the probe sees nested fields")
        for entry in try manifest().requests {
            XCTAssertEqual(entry.reads, decoded[entry.name] ?? [:], "\(entry.name): reads")
        }
    }

    // MARK: - One place builds requests

    func testOnlyTheEndpointTableNamesAPathAndOnlyTranHttpSends() throws {
        let sources = RepoFixtures.root.appendingPathComponent("apps/ios/Sources/TranVotingDemo")
        let walker = try XCTUnwrap(FileManager.default.enumerator(atPath: sources.path))
        var paths: Set<String> = [], senders: Set<String> = []
        for case let file as String in walker where file.hasSuffix(".swift") && !file.hasPrefix("Generated/") {
            let code = try String(contentsOf: sources.appendingPathComponent(file), encoding: .utf8)
                .split(separator: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
                .joined(separator: "\n")
            if code.contains("ApiContract.basePath") || code.contains("ApiContract.healthPath") { paths.insert(file) }
            for sender in ["URLRequest(", ".data(for", ".data(from", "dataTask(", ".upload(", ".download(", ".bytes("]
            where code.contains(sender) {
                senders.insert(file)
            }
        }
        XCTAssertEqual(paths, ["Api/TranEndpoint.swift"])
        XCTAssertEqual(senders, ["Api/TranHttp.swift"])
    }
}

/// Any JSON value, compared structurally; the manifest's `{version}` and `{refresh_token}` filled.
private enum AnyJSON: Decodable, Equatable {
    case null, bool(Bool), number(Double), string(String), array([AnyJSON]), object([String: AnyJSON])

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let bool = try? value.decode(Bool.self) { self = .bool(bool) }
        else if let number = try? value.decode(Double.self) { self = .number(number) }
        else if let string = try? value.decode(String.self) { self = .string(string) }
        else if let array = try? value.decode([AnyJSON].self) { self = .array(array) }
        else { self = .object(try value.decode([String: AnyJSON].self)) }
    }

    func filled(version: String, refreshToken: String?) -> AnyJSON {
        switch self {
        case let .string(text):
            return .string(
                text.replacingOccurrences(of: "{version}", with: version)
                    .replacingOccurrences(of: "{refresh_token}", with: refreshToken ?? "{refresh_token}"))
        case let .array(items): return .array(items.map { $0.filled(version: version, refreshToken: refreshToken) })
        case let .object(fields): return .object(fields.mapValues { $0.filled(version: version, refreshToken: refreshToken) })
        default: return self
        }
    }
}

/// Decodes a type with placeholder values and records every key it asks for, as a dotted path
/// with its JSON type: the fields the app reads, optional ones included.
private final class ReadProbe {
    private(set) var reads: [String: String] = [:]

    static func reads<T: Decodable>(_ type: T.Type) throws -> [String: String] {
        let probe = ReadProbe()
        _ = try T(from: ProbeDecoder(probe: probe, codingPath: []))
        return probe.reads
    }

    func record(_ path: [CodingKey], _ type: String) {
        reads[path.map(\.stringValue).joined(separator: ".")] = type
    }
}

private struct ProbeDecoder: Decoder {
    let probe: ReadProbe
    let codingPath: [CodingKey]
    var userInfo: [CodingUserInfoKey: Any] { [:] }

    func container<Key: CodingKey>(keyedBy type: Key.Type) throws -> KeyedDecodingContainer<Key> {
        KeyedDecodingContainer(ProbeContainer<Key>(probe: probe, codingPath: codingPath))
    }

    func unkeyedContainer() throws -> UnkeyedDecodingContainer {
        throw DecodingError.typeMismatch([Any].self, .init(codingPath: codingPath, debugDescription: "the probe reads objects"))
    }

    func singleValueContainer() throws -> SingleValueDecodingContainer {
        throw DecodingError.typeMismatch(Any.self, .init(codingPath: codingPath, debugDescription: "the probe reads objects"))
    }
}

private struct ProbeContainer<Key: CodingKey>: KeyedDecodingContainerProtocol {
    let probe: ReadProbe
    let codingPath: [CodingKey]
    var allKeys: [Key] { [] }

    func contains(_ key: Key) -> Bool { true }
    func decodeNil(forKey key: Key) throws -> Bool { false }

    private func read<T>(_ key: Key, _ type: String, _ value: T) -> T {
        probe.record(codingPath + [key], type)
        return value
    }

    func decode(_ type: Bool.Type, forKey key: Key) throws -> Bool { read(key, "boolean", false) }
    func decode(_ type: String.Type, forKey key: Key) throws -> String { read(key, "string", "") }
    func decode(_ type: Double.Type, forKey key: Key) throws -> Double { read(key, "number", 0) }
    func decode(_ type: Float.Type, forKey key: Key) throws -> Float { read(key, "number", 0) }
    func decode(_ type: Int.Type, forKey key: Key) throws -> Int { read(key, "number", 0) }
    func decode(_ type: Int8.Type, forKey key: Key) throws -> Int8 { read(key, "number", 0) }
    func decode(_ type: Int16.Type, forKey key: Key) throws -> Int16 { read(key, "number", 0) }
    func decode(_ type: Int32.Type, forKey key: Key) throws -> Int32 { read(key, "number", 0) }
    func decode(_ type: Int64.Type, forKey key: Key) throws -> Int64 { read(key, "number", 0) }
    func decode(_ type: UInt.Type, forKey key: Key) throws -> UInt { read(key, "number", 0) }
    func decode(_ type: UInt8.Type, forKey key: Key) throws -> UInt8 { read(key, "number", 0) }
    func decode(_ type: UInt16.Type, forKey key: Key) throws -> UInt16 { read(key, "number", 0) }
    func decode(_ type: UInt32.Type, forKey key: Key) throws -> UInt32 { read(key, "number", 0) }
    func decode(_ type: UInt64.Type, forKey key: Key) throws -> UInt64 { read(key, "number", 0) }

    func decode<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T {
        try T(from: ProbeDecoder(probe: probe, codingPath: codingPath + [key]))
    }

    func nestedContainer<NestedKey: CodingKey>(
        keyedBy type: NestedKey.Type, forKey key: Key
    ) throws -> KeyedDecodingContainer<NestedKey> {
        KeyedDecodingContainer(ProbeContainer<NestedKey>(probe: probe, codingPath: codingPath + [key]))
    }

    func nestedUnkeyedContainer(forKey key: Key) throws -> UnkeyedDecodingContainer {
        try ProbeDecoder(probe: probe, codingPath: codingPath + [key]).unkeyedContainer()
    }

    func superDecoder() throws -> Decoder { ProbeDecoder(probe: probe, codingPath: codingPath) }
    func superDecoder(forKey key: Key) throws -> Decoder { ProbeDecoder(probe: probe, codingPath: codingPath + [key]) }
}
