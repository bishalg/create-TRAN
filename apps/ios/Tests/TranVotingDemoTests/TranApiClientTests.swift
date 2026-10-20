// Verifies: REQ-NAT-011
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

    private func makeClient(includeDebugCountry: Bool = false) -> TranApiClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return TranApiClient(
            baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: URLSession(configuration: configuration),
            includeDebugCountry: includeDebugCountry
        )
    }

    private func respond(status: Int, body: String = "{}") {
        StubURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (response, Data(body.utf8))
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

    func testHttpRejectionIsOnlineBecauseTheServerAnswered() async throws {
        respond(status: 403)
        do {
            try await makeClient().checkHealth()
            XCTFail("the client must throw on a rejection")
        } catch let error as TranApiError {
            XCTAssertEqual(error, .rejected(status: 403))
            XCTAssertEqual(TranApiStatus.from(error), .online)
        }
    }

    func testUnreachableServerIsOffline() async throws {
        StubURLProtocol.handler = { _ in throw URLError(.cannotConnectToHost) }
        do {
            try await makeClient().checkHealth()
            XCTFail("the client must throw when nothing answers")
        } catch let error as TranApiError {
            XCTAssertEqual(error, .offline)
            XCTAssertEqual(TranApiStatus.from(error), .offline)
        }
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
