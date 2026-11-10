// Verifies: REQ-VER-001 REQ-VER-004 REQ-VER-008 REQ-VER-010
import XCTest

/// `fixtures/compat.json` on iOS (spec 028): the generated contract equals the fixture, every rule
/// reaches the app through UniFFI unchanged, and the app reads every "response from the future"
/// with its own code: extra fields ignored, an unknown enum value read as its fallback, an unknown
/// error code classified by its status.
final class CompatTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        try XCTUnwrap(RepoFixtures.json("fixtures/compat.json") as? [String: Any])
    }

    private func rows(_ key: String) throws -> [[String: Any]] {
        try XCTUnwrap(fixture()[key] as? [[String: Any]], key)
    }

    /// JSON `null` as Swift `nil`.
    private func string(_ value: Any?) -> String? { value as? String }

    // MARK: - The generated contract

    func testTheGeneratedContractIsTheFixture() throws {
        let json = try fixture()
        XCTAssertEqual(ApiContract.basePath, json["basePath"] as? String)
        XCTAssertEqual(ApiContract.healthPath, json["healthPath"] as? String)
        let headers = try XCTUnwrap(json["headers"] as? [String: String])
        XCTAssertEqual(ApiContract.clientHeader, headers["client"])
        XCTAssertEqual(ApiContract.updateHeader, headers["update"])
        XCTAssertEqual(ApiContract.updateRecommended, headers["updateRecommended"])
        XCTAssertEqual(ApiContract.recommendedVersionHeader, headers["recommendedVersion"])
    }

    func testTheWireEnumTablesAreTheFixture() throws {
        let generated: [String: (field: String, values: [String], fallback: String)] = [
            "user_role": (
                ApiContract.WireEnums.UserRole.field, ApiContract.WireEnums.UserRole.values,
                ApiContract.WireEnums.UserRole.fallback
            ),
            "country_source": (
                ApiContract.WireEnums.CountrySource.field, ApiContract.WireEnums.CountrySource.values,
                ApiContract.WireEnums.CountrySource.fallback
            ),
        ]
        let enums = try rows("wireEnums")
        XCTAssertEqual(Set(enums.compactMap { $0["name"] as? String }), Set(generated.keys))
        for row in enums {
            let name = try XCTUnwrap(row["name"] as? String)
            let table = try XCTUnwrap(generated[name])
            XCTAssertEqual(table.field, row["field"] as? String, name)
            XCTAssertEqual(table.values, row["values"] as? [String], name)
            XCTAssertEqual(table.fallback, row["fallback"] as? String, name)
        }
    }

    // MARK: - The rules through UniFFI

    private func wire(_ platform: TranClientPlatform) -> String {
        switch platform {
        case .ios: return "ios"
        case .android: return "android"
        case .web: return "web"
        case .unknown: return "unknown"
        }
    }

    private func wire(_ standing: TranClientStanding) -> String {
        switch standing {
        case .supported: return "supported"
        case .updateRecommended: return "update_recommended"
        case .upgradeRequired: return "upgrade_required"
        }
    }

    private static let platforms: [String: TranClientPlatform] = ["ios": .ios, "android": .android, "web": .web]
    private static let standings: [String: TranClientStanding] = [
        "supported": .supported, "update_recommended": .updateRecommended, "upgrade_required": .upgradeRequired,
    ]

    func testClientHeadersParseAsTheFixtureSays() throws {
        for row in try rows("clients") {
            let name = row["name"] as? String ?? "?"
            let client = parseClient(header: string(row["header"]))
            XCTAssertEqual(wire(client.platform), row["platform"] as? String, name)
            XCTAssertEqual(client.version, string(row["version"]), name)
        }
    }

    func testClientHeadersFormatAsTheFixtureSays() throws {
        for row in try rows("formatted") {
            let platform = try XCTUnwrap(Self.platforms[row["platform"] as? String ?? ""])
            let version = try XCTUnwrap(row["version"] as? String)
            XCTAssertEqual(formatClient(platform: platform, version: version), row["header"] as? String)
        }
    }

    func testVersionsCompareAsTheFixtureSays() throws {
        for row in try rows("versions") {
            let a = try XCTUnwrap(row["a"] as? String), b = try XCTUnwrap(row["b"] as? String)
            XCTAssertEqual(Int(compareVersions(a: a, b: b)), row["order"] as? Int, "\(a) vs \(b)")
        }
    }

    func testStandingsAreTheFixtures() throws {
        for row in try rows("standings") {
            let client = parseClient(header: string(row["client"]))
            let standing = clientStanding(
                client: client, minimum: string(row["minimum"]), recommended: string(row["recommended"]))
            XCTAssertEqual(wire(standing), row["standing"] as? String, row["name"] as? String ?? "?")
        }
    }

    func testThePromptShowsAsTheFixtureSays() throws {
        for row in try rows("updatePrompts") {
            let standing = try XCTUnwrap(Self.standings[row["standing"] as? String ?? ""])
            let state = TranUpdatePromptState(
                standing: standing,
                recommendedVersion: string(row["recommendedVersion"]),
                dismissedVersion: string(row["dismissedVersion"]))
            XCTAssertEqual(updatePrompt(state: state), row["show"] as? Bool, row["name"] as? String ?? "?")
        }
    }

    func testWireEnumsDecodeToTheirFallback() throws {
        for row in try rows("wireEnumCases") {
            let name = try XCTUnwrap(row["enum"] as? String), raw = try XCTUnwrap(row["raw"] as? String)
            XCTAssertEqual(decodeWireEnum(name: name, raw: raw), row["decoded"] as? String, "\(name) \(raw)")
        }
        // The app's own reader of `role` goes through the same table.
        XCTAssertEqual(TranSessionClient.TokenPair.User.role("returning_officer"), "citizen_voter")
        XCTAssertEqual(TranSessionClient.TokenPair.User.role("election_auditor"), "election_auditor")
    }

    // MARK: - Responses from the future (REQ-VER-008)

    /// The value at a dotted path (`user.role`, `components.0.name`) of decoded JSON.
    private func value(at path: String, in json: Any) -> Any? {
        path.split(separator: ".").reduce(json as Any?) { node, key in
            if let array = node as? [Any], let index = Int(key) { return index < array.count ? array[index] : nil }
            return (node as? [String: Any])?[String(key)]
        }
    }

    /// What the app reads from each answer, as JSON paths: the token pair is the only body it decodes.
    private func appReads(_ route: String, _ body: Data) throws -> [String: Any]? {
        switch route {
        case "POST \(TranEndpoint.signIn.template)", "POST \(TranEndpoint.refresh.template)":
            let pair = try JSONDecoder().decode(TranSessionClient.TokenPair.self, from: body)
            var read: [String: Any] = [
                "access_token": pair.access_token, "user.user_id": pair.user.user_id, "user.role": pair.user.role,
            ]
            read["refresh_token"] = pair.refresh_token
            return read
        default:
            return nil
        }
    }

    /// The endpoint the app calls for a route, if it calls it at all.
    private func endpoint(_ route: String) -> TranEndpoint? {
        TranEndpoint.allCases.first { "\($0.method) \($0.template)" == route }
    }

    func testEveryResponseFromTheFutureIsReadByTheApp() async throws {
        let future = try rows("responsesFromTheFuture")
        XCTAssertFalse(future.isEmpty)
        for row in future {
            let route = try XCTUnwrap(row["route"] as? String)
            let status = try XCTUnwrap(row["status"] as? Int)
            let body = try JSONSerialization.data(withJSONObject: try XCTUnwrap(row["body"]))
            let expect = try XCTUnwrap(row["expect"] as? [String: Any])

            if route == "error envelope" {
                // An unknown code is classified by its status; the request id is still read.
                let response = HTTPURLResponse(
                    url: URL(string: "http://127.0.0.1:3001")!, statusCode: status, httpVersion: nil,
                    headerFields: nil)!
                let failure = TranRequestFailure.rejected(response, body: body)
                XCTAssertEqual(failure.spec.wireCode, expect["code"] as? String, route)
                XCTAssertEqual(failure.requestId, expect["request_id"] as? String, route)
                continue
            }

            guard let endpoint = endpoint(route) else {
                // A route this app never calls (`clients/ios/current.json` lists every call).
                continue
            }
            guard let read = try appReads(route, body) else {
                // The app does not read this body: the real call succeeds on the newer answer.
                try await call(endpoint, answering: status, body: body)
                continue
            }
            for (path, expected) in expect {
                // A field the app does not read is ignored by construction.
                guard let actual = read[path] else { continue }
                XCTAssertEqual("\(actual)", "\(expected)", "\(route) › \(path)")
            }
            XCTAssertEqual(
                Set(read.keys).intersection(expect.keys).isEmpty, false,
                "\(route): the fixture expects nothing the app reads")
        }
    }

    /// Runs the app's call for `endpoint` against a server that answers `status` and `body`; for
    /// the calls whose body the app does not read.
    private func call(_ endpoint: TranEndpoint, answering status: Int, body: Data) async throws {
        let text = String(decoding: body, as: UTF8.self)
        let vault = InMemorySessionVault(SessionWire.stored())
        SessionStubProtocol.reset { request in
            // The session's own refresh (before an authorised call) gets today's answer.
            if endpoint != .refresh, request.path == TranEndpoint.refresh.path() {
                return .status(200, body: SessionWire.pair(access: "a", refresh: "r"))
            }
            return .status(status, body: text)
        }
        let session = TranSessionClient(
            vault: vault, baseUrl: URL(string: "http://127.0.0.1:3001")!, session: SessionStubProtocol.session(),
            log: { failure in XCTFail("\(endpoint): \(failure.code)") }, onStanding: { _ in })
        let api = TranApiClient(
            baseUrl: URL(string: "http://127.0.0.1:3001")!, session: SessionStubProtocol.session(),
            retry: TranRetry(sleep: { _ in }, random: { 0 }), onStanding: { _ in })
        switch endpoint {
        case .checkHealth: try await api.checkHealth()
        case .confirmEligibility: try await api.confirmEligibility(age: 20, countryCode: "NP")
        case .validateSession:
            let outcome = await session.validate()
            XCTAssertEqual(outcome, .valid, "\(endpoint)")
        case .signIn, .refresh, .signOut, .deleteAccount, .registerDevice, .unregisterDevice:
            XCTFail("\(endpoint): its body is decoded (appReads) or it answers 204 with none")
        }
    }
}
