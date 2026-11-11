// Verifies: REQ-NAT-011 REQ-ERR-004 REQ-ERR-005 REQ-ROB-002 REQ-ROB-010 REQ-VER-001 REQ-OBS-010 REQ-OBS-011
import Foundation

/// Status pill states — the same vocabulary as the web footer (`shell.status.*`).
enum TranApiStatus: Equatable {
    case checking
    case online
    case offline

    /// Only a failure the catalogue shows as a banner (no answer at all) is "offline"; a
    /// rejection or a 500 means the server answered.
    static func from(_ failure: TranRequestFailure) -> TranApiStatus {
        if case .banner = failure.spec.presentation { return .offline }
        return .online
    }
}

/// Every failure the client sees, classified against the Rust catalogue (REQ-ERR-004).
/// Users see `L10n.feedback(spec.messageKey)`, never a server or system message.
struct TranRequestFailure: Error, Equatable {
    let code: TranErrorCode
    var status: Int? = nil
    var requestId: String? = nil
    var traceId: String? = nil
    /// The server's `Retry-After`, already capped by the catalogue (`retryAfterMs(header:)`).
    var retryAfterDelayMs: UInt64? = nil

    var spec: TranErrorSpec { errorSpec(code: code) }

    /// The API envelope. Decoding fails — and the body is ignored as a whole — unless every field
    /// has its documented type (REQ-ROB-010), exactly like the web's Zod schema.
    private struct Envelope: Decodable {
        let success: Bool
        let error: String
        let code: String?
        let retryable: Bool?
        let request_id: String?
    }

    /// The envelope's `code` when the body is one, else the catalogue's status fallback table. A
    /// request id that is not log-safe is dropped (REQ-ROB-010).
    static func rejected(_ response: HTTPURLResponse, body: Data, traceId: String? = nil) -> TranRequestFailure {
        let envelope = (try? JSONDecoder().decode(Envelope.self, from: body)).flatMap {
            $0.success ? nil : $0
        }
        let status = response.statusCode
        let code =
            envelope?.code.flatMap { errorCodeFromWire(raw: $0) }
            ?? errorCodeForHttpStatus(status: UInt16(clamping: status))
        let requestId = envelope?.request_id ?? response.value(forHTTPHeaderField: "x-request-id")
        return TranRequestFailure(
            code: code,
            status: status,
            requestId: requestId.flatMap { isValidRequestId(value: $0) ? $0 : nil },
            traceId: traceId,
            retryAfterDelayMs: response.value(forHTTPHeaderField: "retry-after").flatMap {
                retryAfterMs(header: $0)
            }
        )
    }

    /// `URLError`s that mean "no answer from the server". Anything else — a malformed URL, an
    /// unsupported scheme — is a bug in the app, never "offline" (REQ-ROB-002).
    private static let connectivityErrors: Set<URLError.Code> = [
        .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost,
        .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed, .callIsActive,
        .secureConnectionFailed, .cannotLoadFromNetwork, .badServerResponse,
    ]

    /// No HTTP answer: a timeout, a cancellation, or no route to the server.
    static func classify(_ error: Error, traceId: String? = nil) -> TranRequestFailure {
        if var failure = error as? TranRequestFailure {
            if failure.traceId == nil { failure.traceId = traceId }
            return failure
        }
        if error is CancellationError { return TranRequestFailure(code: .requestCancelled, traceId: traceId) }
        guard let urlError = error as? URLError else {
            return TranRequestFailure(code: .clientUnexpected, traceId: traceId)
        }
        switch urlError.code {
        case .timedOut: return TranRequestFailure(code: .networkTimeout, traceId: traceId)
        case .cancelled: return TranRequestFailure(code: .requestCancelled, traceId: traceId)
        case let code where connectivityErrors.contains(code):
            return TranRequestFailure(code: .networkOffline, traceId: traceId)
        default: return TranRequestFailure(code: .clientUnexpected, traceId: traceId)
        }
    }
}

/// Retries retryable failures of idempotent calls on the Rust schedule (REQ-ERR-005, REQ-OBS-010).
struct TranRetry {
    /// Injected in tests so the backoff never really waits.
    var sleep: @Sendable (UInt64) async throws -> Void = { ms in
        try await Task.sleep(nanoseconds: ms * 1_000_000)
    }
    var random: @Sendable () -> Double = { Double.random(in: 0..<1) }

    static func newTraceId() -> String {
        var bytes = [UInt8](repeating: 0, count: 24)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return newTraceOffline(randomBytes: Data(bytes), sampled: true)?.traceId ?? String(repeating: "1", count: 32)
    }

    static func newChildSpan(traceId: String) -> TranTraceContext? {
        var spanBytes = [UInt8](repeating: 0, count: 8)
        _ = SecRandomCopyBytes(kSecRandomDefault, spanBytes.count, &spanBytes)
        return childSpanOffline(traceId: traceId, randomBytes: Data(spanBytes), sampled: true)
    }

    func run<T>(
        idempotent: Bool,
        traceId: String? = nil,
        _ call: (String) async throws -> T
    ) async throws -> T {
        let policy = retryPolicy()
        let tid = traceId ?? Self.newTraceId()
        var attempt: UInt32 = 1
        while true {
            do {
                return try await call(tid)
            } catch {
                let failure = TranRequestFailure.classify(error, traceId: tid)
                guard idempotent, failure.spec.retryable, attempt < policy.maxAttempts else {
                    throw failure
                }
                try await sleep(failure.retryAfterDelayMs ?? retryDelayMs(retry: attempt, random: random()))
                attempt += 1
            }
        }
    }

    func run<T>(idempotent: Bool, _ call: () async throws -> T) async throws -> T {
        try await run(idempotent: idempotent, traceId: nil) { _ in try await call() }
    }
}

/// Build-time configuration (REQ-NAT-011, ADR-0023).
enum TranApiConfig {
    static let baseUrlKey = "TranApiBaseUrl"
    static let defaultBaseUrl = URL(string: "http://127.0.0.1:3001")!

    /// Launch argument (`-TranApiBaseUrl http://…`, used by the UI tests) → Info.plist value
    /// (`$(TRAN_API_BASE_URL)`, expanded at build time) → loopback default.
    static func baseUrl(
        defaults: UserDefaults = .standard,
        bundle: Bundle = .main
    ) -> URL {
        if let override = usable(defaults.string(forKey: baseUrlKey)) { return override }
        if let plistValue = usable(bundle.object(forInfoDictionaryKey: baseUrlKey) as? String) {
            return plistValue
        }
        return defaultBaseUrl
    }

    /// The dev-only `X-Debug-Country` header is never sent by a release build.
    static var includeDebugCountry: Bool {
        #if DEBUG
            return true
        #else
            return false
        #endif
    }

    private static func usable(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty, !raw.hasPrefix("$("), let url = URL(string: raw),
            url.scheme != nil
        else { return nil }
        return url
    }
}

/// Thin client for the Axum API: the device verdict is the product (REQ-NAT-002), so the response
/// body is not parsed — the call only confirms the API is reachable and agrees.
struct TranApiClient {
    private let http: TranHttp
    private let includeDebugCountry: Bool
    private let retry: TranRetry

    init(
        baseUrl: URL = TranApiConfig.baseUrl(),
        session: URLSession = TranApiClient.defaultSession,
        includeDebugCountry: Bool = TranApiConfig.includeDebugCountry,
        retry: TranRetry = TranRetry(),
        client: String = TranClientIdentity.current,
        onStanding: @escaping @Sendable (TranStandingSignal) -> Void = TranUpdateCenter.post
    ) {
        self.http = TranHttp(baseUrl: baseUrl, session: session, client: client, onStanding: onStanding)
        self.includeDebugCountry = includeDebugCountry
        self.retry = retry
    }

    /// The catalogue's per-attempt timeout: a status pill must never make the dashboard feel stuck.
    static let defaultSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = TimeInterval(retryPolicy().requestTimeoutMs) / 1000
        configuration.waitsForConnectivity = false
        let stubs = TranApiStub.protocolClasses()
        if !stubs.isEmpty {
            configuration.protocolClasses = stubs + (configuration.protocolClasses ?? [])
        }
        return URLSession(configuration: configuration)
    }()

    func checkHealth(traceId: String? = nil) async throws {
        try await retry.run(idempotent: true, traceId: traceId) { tid in
            try await send(.checkHealth, body: nil, countryCode: nil, traceId: tid)
        }
    }

    /// One health request without retries: the recovery probe's question (REQ-ERR-013).
    func probeHealth(traceId: String? = nil) async throws {
        try await send(.checkHealth, body: nil, countryCode: nil, traceId: traceId)
    }

    /// A pure computation on the server, so it is safe to retry.
    func confirmEligibility(age: UInt16, countryCode: String, traceId: String? = nil) async throws {
        let body = Data("{\"age\":\(age)}".utf8)
        try await retry.run(idempotent: true, traceId: traceId) { tid in
            try await send(.confirmEligibility, body: body, countryCode: countryCode, traceId: tid)
        }
    }

    /// The answer's body is not read: success is the whole answer (REQ-NAT-002, REQ-VER-008).
    private func send(_ endpoint: TranEndpoint, body: Data?, countryCode: String?, traceId: String? = nil) async throws {
        let tid = traceId ?? TranRetry.newTraceId()
        let span = TranRetry.newChildSpan(traceId: tid)
        let tp = span.map { formatTraceparentOffline(context: $0) }
        var request = http.request(endpoint, body: body, traceparent: tp)
        if includeDebugCountry, let countryCode, Self.isCountryCode(countryCode) {
            request.setValue(countryCode.uppercased(), forHTTPHeaderField: "X-Debug-Country")
        }
        _ = try await http.send(request)
    }

    private static func isCountryCode(_ value: String) -> Bool {
        value.count == 2 && value.allSatisfy { $0.isASCII && $0.isLetter }
    }
}
