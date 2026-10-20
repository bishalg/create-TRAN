// Verifies: REQ-NAT-011 REQ-ERR-004 REQ-ERR-005 REQ-ROB-002 REQ-ROB-010
import XCTest

/// The native client contract on a stubbed `URLSession`: paths, payloads, debug gating, offline
/// split. No test opens a socket, so the suite never needs a running API.
final class TranApiClientTests: XCTestCase {
    /// Replays canned outcomes and records what the client actually sent.
    private final class StubURLProtocol: URLProtocol {
        static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
        static var requests: [URLRequest] = []

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            Self.requests.append(request)
            guard let handler = Self.handler else {
                client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
                return
            }
            do {
                let (response, data) = try handler(request)
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            } catch {
                client?.urlProtocol(self, didFailWithError: error)
            }
        }

        override func stopLoading() {}
    }

    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    /// Retries never really wait in tests.
    private static let instant = TranRetry(sleep: { _ in }, random: { 0 })

    private func makeClient(includeDebugCountry: Bool = false) -> TranApiClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return TranApiClient(
            baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: URLSession(configuration: configuration),
            includeDebugCountry: includeDebugCountry,
            retry: Self.instant
        )
    }

    private func respond(status: Int, body: String = "{}", headers: [String: String]? = nil) {
        StubURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
            return (response, Data(body.utf8))
        }
    }

    private func failure(_ call: () async throws -> Void) async -> TranRequestFailure? {
        do {
            try await call()
            return nil
        } catch {
            return error as? TranRequestFailure
        }
    }

    private func lastRequest() throws -> URLRequest {
        try XCTUnwrap(StubURLProtocol.requests.last)
    }

    func testHealthChecksTheHealthEndpoint() async throws {
        respond(status: 200)
        try await makeClient().checkHealth()

        let request = try lastRequest()
        XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:3001/api/health")
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertNil(request.bodyData)
    }

    func testConfirmPostsOnlyTheAge() async throws {
        respond(status: 200)
        try await makeClient().confirmEligibility(age: 20, countryCode: "NP")

        let request = try lastRequest()
        XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:3001/api/vote/eligibility")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(request.bodyData)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["age"] as? Int, 20)
        XCTAssertEqual(json.count, 1, "only the age is posted; the country rides the debug header")
    }

    func testDebugCountryHeaderIsSentOnlyWhenTheDebugGateIsOn() async throws {
        respond(status: 200)
        try await makeClient(includeDebugCountry: true)
            .confirmEligibility(age: 20, countryCode: "np")
        XCTAssertEqual(try lastRequest().value(forHTTPHeaderField: "X-Debug-Country"), "NP")

        try await makeClient(includeDebugCountry: false)
            .confirmEligibility(age: 20, countryCode: "NP")
        XCTAssertNil(try lastRequest().value(forHTTPHeaderField: "X-Debug-Country"))
    }

    func testDebugCountryHeaderSkipsNonCountryValues() async throws {
        respond(status: 200)
        try await makeClient(includeDebugCountry: true)
            .confirmEligibility(age: 20, countryCode: "N1")
        XCTAssertNil(try lastRequest().value(forHTTPHeaderField: "X-Debug-Country"))
    }

    func testHealthIsSentWithoutTheDebugHeader() async throws {
        respond(status: 200)
        try await makeClient(includeDebugCountry: true).checkHealth()
        XCTAssertNil(try lastRequest().value(forHTTPHeaderField: "X-Debug-Country"))
    }

    func testEnvelopeCodeAndRequestIdAreRead() async throws {
        respond(
            status: 400,
            body: #"{"success":false,"error":"nope","code":"validation.invalid_country_code","retryable":false,"request_id":"req-1"}"#
        )
        let failure = await failure { try await makeClient().confirmEligibility(age: 20, countryCode: "NP") }
        XCTAssertEqual(failure?.code, .validationInvalidCountryCode)
        XCTAssertEqual(failure?.requestId, "req-1")
        XCTAssertEqual(StubURLProtocol.requests.count, 1, "validation is never retried")
        XCTAssertEqual(failure.map(TranApiStatus.from), .online)
    }

    func testStatusWithoutACodeUsesTheFallbackTableAndTheHeaderId() async throws {
        respond(status: 403, body: "<html>", headers: ["x-request-id": "edge-7"])
        let failure = await failure { try await makeClient().checkHealth() }
        XCTAssertEqual(failure?.code, .requestMalformed)
        XCTAssertEqual(failure?.status, 403)
        XCTAssertEqual(failure?.requestId, "edge-7")
        XCTAssertEqual(failure.map(TranApiStatus.from), .online, "the server answered")
    }

    func testFlakyServerIsRetriedUntilItAnswers() async throws {
        var calls = 0
        StubURLProtocol.handler = { request in
            calls += 1
            let status = calls == 1 ? 503 : 200
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: nil,
                headerFields: ["retry-after": "1"])!
            return (response, Data("{}".utf8))
        }
        try await makeClient().confirmEligibility(age: 20, countryCode: "NP")
        XCTAssertEqual(StubURLProtocol.requests.count, 2)
    }

    func testRetryWaitsTheRustScheduleOrTheServersRetryAfter() async throws {
        let waits = WaitLog()
        let retry = TranRetry(sleep: { await waits.add($0) }, random: { 0.5 })
        var attempt = 0
        let outcome: Int? = try? await retry.run(idempotent: true) { () async throws -> Int in
            attempt += 1
            if attempt == 1 { throw TranRequestFailure(code: .serverInternal) }
            if attempt == 2 { throw TranRequestFailure(code: .serverRateLimited, retryAfterDelayMs: 2000) }
            return attempt
        }
        XCTAssertEqual(outcome, 3)
        let recorded = await waits.values
        XCTAssertEqual(recorded, [retryDelayMs(retry: 1, random: 0.5), 2000])
    }

    func testNonIdempotentCallsAreNeverRetried() async {
        var attempts = 0
        let failure = await failure {
            _ = try await TranApiClientTests.instant.run(idempotent: false) { () async throws -> Int in
                attempts += 1
                throw TranRequestFailure(code: .serverUnavailable)
            }
        }
        XCTAssertEqual(attempts, 1)
        XCTAssertEqual(failure?.code, .serverUnavailable)
    }

    func testUnreachableServerIsOfflineAfterEveryAttempt() async throws {
        StubURLProtocol.handler = { _ in throw URLError(.cannotConnectToHost) }
        let failure = await failure { try await makeClient().checkHealth() }
        XCTAssertEqual(failure?.code, .networkOffline)
        XCTAssertEqual(StubURLProtocol.requests.count, Int(retryPolicy().maxAttempts))
        XCTAssertEqual(failure.map(TranApiStatus.from), .offline)
    }

    func testTransportErrorsAreClassified() {
        XCTAssertEqual(TranRequestFailure.classify(URLError(.timedOut)).code, .networkTimeout)
        XCTAssertEqual(TranRequestFailure.classify(URLError(.cancelled)).code, .requestCancelled)
        XCTAssertEqual(TranRequestFailure.classify(CancellationError()).code, .requestCancelled)
        XCTAssertEqual(TranRequestFailure.classify(URLError(.notConnectedToInternet)).code, .networkOffline)
        XCTAssertEqual(TranRequestFailure.classify(NSError(domain: "x", code: 1)).code, .clientUnexpected)
    }

    func testOnlyConnectivityErrorsAreOffline() {
        for code: URLError.Code in [.cannotConnectToHost, .networkConnectionLost, .cannotFindHost] {
            XCTAssertEqual(TranRequestFailure.classify(URLError(code)).code, .networkOffline, "\(code)")
        }
        for code: URLError.Code in [.badURL, .unsupportedURL, .cannotDecodeContentData] {
            XCTAssertEqual(TranRequestFailure.classify(URLError(code)).code, .clientUnexpected, "\(code)")
        }
    }

    private func fixture(_ name: String) throws -> [String: Any] {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("fixtures/\(name)"))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    /// `fixtures/failure-modes.json` `responses`: the same answers the web and Android classify.
    func testEveryFailureModeResponseClassifiesLikeTheOtherClients() async throws {
        let rows = try fixture("failure-modes.json")["responses"] as! [[String: Any]]
        XCTAssertFalse(rows.isEmpty)
        for row in rows {
            let label = "\(row["id"]!) \(row["name"]!)"
            let expect = row["expect"] as! [String: Any]
            respond(
                status: row["status"] as! Int,
                body: row["body"] as! String,
                headers: row["headers"] as? [String: String]
            )
            let failure = await failure { try await makeClient().checkHealth() }
            XCTAssertEqual(failure?.spec.wireCode, expect["code"] as? String, label)
            XCTAssertEqual(failure?.status, row["status"] as? Int, label)
            XCTAssertEqual(failure?.requestId, expect["requestId"] as? String, label)
            if let delay = expect["retryAfterMs"] {
                XCTAssertEqual(failure?.retryAfterDelayMs, (delay as? Int).map(UInt64.init), label)
            }
        }
    }

    func testRequestIdShapeMatchesTheFixture() throws {
        let ids = try fixture("feedback.json")["requestIds"] as! [String: [String]]
        for id in ids["valid"]! { XCTAssertTrue(isValidRequestId(value: id), id) }
        for id in ids["invalid"]! { XCTAssertFalse(isValidRequestId(value: id), id) }
    }

    func testBaseUrlResolvesLaunchArgumentThenPlistThenLoopback() throws {
        let suite = "TranApiClientTests.baseUrl"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defaults.removePersistentDomain(forName: suite)

        // Nothing configured: the loopback default (the unit-test bundle has no TranApiBaseUrl key).
        let testBundle = Bundle(for: TranApiClientTests.self)
        XCTAssertEqual(
            TranApiConfig.baseUrl(defaults: defaults, bundle: testBundle),
            URL(string: "http://127.0.0.1:3001")!
        )

        // A launch argument (`-TranApiBaseUrl http://…`) wins over the plist.
        defaults.set("http://127.0.0.1:1", forKey: TranApiConfig.baseUrlKey)
        XCTAssertEqual(
            TranApiConfig.baseUrl(defaults: defaults, bundle: testBundle),
            URL(string: "http://127.0.0.1:1")!
        )
        XCTAssertEqual(TranApiConfig.includeDebugCountry, true)

        // An unexpanded build setting never becomes a URL.
        defaults.set("$(TRAN_API_BASE_URL)", forKey: TranApiConfig.baseUrlKey)
        XCTAssertEqual(
            TranApiConfig.baseUrl(defaults: defaults, bundle: testBundle),
            URL(string: "http://127.0.0.1:3001")!
        )
        defaults.removePersistentDomain(forName: suite)
    }

    func testBuiltAppCarriesTheConfiguredPlistUrl() {
        // The app bundle is the test host; this pins the `$(TRAN_API_BASE_URL)` wiring end to end.
        let empty = UserDefaults(suiteName: "TranApiClientTests.empty")!
        empty.removePersistentDomain(forName: "TranApiClientTests.empty")
        XCTAssertEqual(
            TranApiConfig.baseUrl(defaults: empty, bundle: .main),
            URL(string: "http://127.0.0.1:3001")!
        )
    }
}

/// Records the backoff the retry loop asked for.
private actor WaitLog {
    private(set) var values: [UInt64] = []
    func add(_ value: UInt64) { values.append(value) }
}

private extension URLRequest {
    /// `URLSession` moves `httpBody` into a stream before it reaches a `URLProtocol`.
    var bodyData: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let size = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: size)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
