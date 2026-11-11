// Verifies: REQ-OBS-010
import XCTest

/// REQ-OBS-010: Every API call carries a trace; retries and token refresh reuse the trace id.
final class TranApiClientTraceTests: XCTestCase {
    private final class TraceStubURLProtocol: URLProtocol {
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
        TraceStubURLProtocol.handler = nil
        TraceStubURLProtocol.requests = []
    }

    private static let instantRetry = TranRetry(sleep: { _ in }, random: { 0 })

    private func makeClient() -> TranApiClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TraceStubURLProtocol.self]
        return TranApiClient(
            baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: URLSession(configuration: configuration),
            includeDebugCountry: false,
            retry: Self.instantRetry
        )
    }

    private func respond(status: Int, body: String = "{}") {
        TraceStubURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: nil, headerFields: [
                    "Content-Type": "application/json",
                ])!
            return (response, Data(body.utf8))
        }
    }

    func testApiCallCarriesValidTraceparentHeader() async throws {
        respond(status: 200)
        try await makeClient().checkHealth()

        XCTAssertEqual(TraceStubURLProtocol.requests.count, 1)
        let request = try XCTUnwrap(TraceStubURLProtocol.requests.first)
        let header = try XCTUnwrap(request.value(forHTTPHeaderField: "traceparent"))
        let parsed = try XCTUnwrap(parseTraceparentOffline(header: header))
        XCTAssertEqual(parsed.traceId.count, 32)
        XCTAssertEqual(parsed.spanId.count, 16)
        XCTAssertTrue(parsed.sampled)
    }

    func testRetryReusesTraceIdWithNewSpanId() async throws {
        var attempts = 0
        TraceStubURLProtocol.handler = { request in
            attempts += 1
            if attempts == 1 {
                let res = HTTPURLResponse(
                    url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!
                return (res, Data("{}".utf8))
            }
            let res = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (res, Data("{}".utf8))
        }

        try await makeClient().checkHealth()

        XCTAssertEqual(TraceStubURLProtocol.requests.count, 2)
        let h1 = try XCTUnwrap(TraceStubURLProtocol.requests[0].value(forHTTPHeaderField: "traceparent"))
        let h2 = try XCTUnwrap(TraceStubURLProtocol.requests[1].value(forHTTPHeaderField: "traceparent"))

        let t1 = try XCTUnwrap(parseTraceparentOffline(header: h1))
        let t2 = try XCTUnwrap(parseTraceparentOffline(header: h2))

        // Same trace ID across retries
        XCTAssertEqual(t1.traceId, t2.traceId)
        // Distinct span IDs
        XCTAssertNotEqual(t1.spanId, t2.spanId)
    }

    func testConfirmEligibilitySendsTrace() async throws {
        respond(status: 200)
        try await makeClient().confirmEligibility(age: 21, countryCode: "NP")

        XCTAssertEqual(TraceStubURLProtocol.requests.count, 1)
        let header = try XCTUnwrap(TraceStubURLProtocol.requests[0].value(forHTTPHeaderField: "traceparent"))
        let parsed = try XCTUnwrap(parseTraceparentOffline(header: header))
        XCTAssertEqual(parsed.traceId.count, 32)
    }
}
