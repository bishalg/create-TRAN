import Foundation
import XCTest

/// A scripted API for the session tests: no socket, no live server (ADR-0023). Each request is
/// recorded with its body read out of the stream; `handler` answers it, optionally after a delay
/// so concurrent calls really overlap.
final class SessionStubProtocol: URLProtocol {
    enum Reply {
        case status(Int, body: String = "{}", delay: TimeInterval = 0, headers: [String: String] = [:])
        case failure(URLError.Code)
    }

    struct Recorded {
        let method: String
        let path: String
        let authorization: String?
        /// `X-Tran-Client` (REQ-VER-004).
        let client: String?
        let body: [String: String]
        /// The body as sent, for one whose values are not all strings.
        let raw: Data
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: (@Sendable (Recorded) -> Reply)?
    nonisolated(unsafe) private static var recorded: [Recorded] = []

    static func reset(_ handler: @escaping @Sendable (Recorded) -> Reply) {
        lock.withLock {
            Self.handler = handler
            recorded = []
        }
    }

    static var requests: [Recorded] { lock.withLock { recorded } }

    static func requests(to path: String) -> [Recorded] { requests.filter { $0.path == path } }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SessionStubProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let raw = request.streamedBody ?? Data()
        let body = try? JSONSerialization.jsonObject(with: raw) as? [String: String]
        let entry = Recorded(
            method: request.httpMethod ?? "GET",
            path: request.url?.path ?? "",
            authorization: request.value(forHTTPHeaderField: "Authorization"),
            client: request.value(forHTTPHeaderField: ApiContract.clientHeader),
            body: body ?? [:],
            raw: raw
        )
        let handler = Self.lock.withLock { () -> (@Sendable (Recorded) -> Reply)? in
            Self.recorded.append(entry)
            return Self.handler
        }
        switch handler?(entry) ?? .failure(.unsupportedURL) {
        case let .failure(code):
            client?.urlProtocol(self, didFailWithError: URLError(code))
        case let .status(status, body, delay, headers):
            // Answered later without blocking the loading thread, so other requests go on.
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: nil,
                headerFields: headers.merging(["Content-Type": "application/json"]) { $1 })!
            let answer = { [self] in
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: Data(body.utf8))
                client?.urlProtocolDidFinishLoading(self)
            }
            if delay > 0 {
                DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: answer)
            } else {
                answer()
            }
        }
    }

    override func stopLoading() {}
}

/// Token pairs as the API sends them on the body transport (`docs/API.md`).
enum SessionWire {
    static func pair(access: String, refresh: String, role: String = "citizen_voter") -> String {
        let user = role == "citizen_voter" ? "voter-001" : "auditor-001"
        return """
            {"access_token":"\(access)","token_type":"Bearer","expires_in":900,\
            "refresh_token":"\(refresh)","user":{"user_id":"\(user)","role":"\(role)"}}
            """
    }

    static let expired =
        #"{"success":false,"error":"Session expired","code":"auth.session_expired","request_id":"req-1"}"#

    static func stored(refresh: String = "refresh-0", role: String = "citizen_voter") -> TranStoredSession {
        TranStoredSession(refreshToken: refresh, userId: "voter-001", roleWire: role)
    }
}

/// Collects what the client logs, so a test can prove no token reached it (REQ-SEC-014).
final class FailureLog: @unchecked Sendable {
    private let lock = NSLock()
    private var failures: [TranRequestFailure] = []

    var entries: [TranRequestFailure] { lock.withLock { failures } }

    var record: @Sendable (TranRequestFailure) -> Void {
        { [self] failure in lock.withLock { failures.append(failure) } }
    }

    /// Every rendering of a logged failure: the log line, the reporter event and a dump.
    var renderings: [String] {
        entries.flatMap { failure -> [String] in
            let event = TranReporting.Event(
                code: failure.spec.wireCode, status: failure.status, requestId: failure.requestId)
            return [TranFeedback.logLine(failure), String(reflecting: event), String(reflecting: failure)]
        }
    }
}

extension URLRequest {
    /// `URLSession` moves `httpBody` into a stream before it reaches a `URLProtocol`.
    var streamedBody: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            guard read > 0 else { break }
            data.append(buffer, count: read)
        }
        return data
    }
}

/// Collects what the clients say about this version (`TranHttp.onStanding`).
final class SignalLog: @unchecked Sendable {
    private let lock = NSLock()
    private var signals: [TranStandingSignal] = []

    var entries: [TranStandingSignal] { lock.withLock { signals } }

    var record: @Sendable (TranStandingSignal) -> Void {
        { [self] signal in lock.withLock { signals.append(signal) } }
    }
}

/// The repository root, for the shared fixtures (`fixtures/…`).
enum RepoFixtures {
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()

    static func json(_ path: String) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent(path)))
    }

    /// The product version `pnpm release` owns (root `package.json`).
    static func treeVersion() throws -> String {
        let package = try XCTUnwrap(json("package.json") as? [String: Any])
        return try XCTUnwrap(package["version"] as? String)
    }
}
