// Verifies: REQ-NAT-011
import Foundation

/// Status pill states — the same vocabulary as the web footer (`shell.status.*`).
enum TranApiStatus: Equatable {
    case checking
    case online
    case offline

    /// Only an unreachable server is "offline"; a rejection means the server answered.
    static func from(_ error: Error) -> TranApiStatus {
        if case TranApiError.rejected = error { return .online }
        return .offline
    }
}

/// Why a call failed. `offline` mirrors the web's `isNetworkError`; `rejected` a non-2xx answer.
enum TranApiError: Error, Equatable {
    case offline
    case rejected(status: Int)
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
    private let baseUrl: URL
    private let session: URLSession
    private let includeDebugCountry: Bool

    init(
        baseUrl: URL = TranApiConfig.baseUrl(),
        session: URLSession = TranApiClient.defaultSession,
        includeDebugCountry: Bool = TranApiConfig.includeDebugCountry
    ) {
        self.baseUrl = baseUrl
        self.session = session
        self.includeDebugCountry = includeDebugCountry
    }

    /// Short timeouts: a status pill must never make the dashboard feel stuck.
    static let defaultSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    func checkHealth() async throws {
        try await send(path: "/api/health", method: "GET", body: nil, countryCode: nil)
    }

    func confirmEligibility(age: UInt16, countryCode: String) async throws {
        let body = Data("{\"age\":\(age)}".utf8)
        try await send(
            path: "/api/vote/eligibility", method: "POST", body: body, countryCode: countryCode)
    }

    private func send(path: String, method: String, body: Data?, countryCode: String?) async throws {
        var request = URLRequest(url: baseUrl.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if includeDebugCountry, let countryCode, Self.isCountryCode(countryCode) {
            request.setValue(countryCode.uppercased(), forHTTPHeaderField: "X-Debug-Country")
        }

        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw TranApiError.offline }
            guard (200..<300).contains(http.statusCode) else {
                throw TranApiError.rejected(status: http.statusCode)
            }
        } catch let error as TranApiError {
            throw error
        } catch {
            throw TranApiError.offline
        }
    }

    private static func isCountryCode(_ value: String) -> Bool {
        value.count == 2 && value.allSatisfy { $0.isASCII && $0.isLetter }
    }
}
