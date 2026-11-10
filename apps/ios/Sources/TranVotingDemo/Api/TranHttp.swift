// Verifies: REQ-VER-001 REQ-VER-004 REQ-VER-009 REQ-VER-010
import Foundation

/// Who this app is on the wire (REQ-VER-004): `ios/<CFBundleShortVersionString>`, formatted by the
/// Rust `formatClient`, so the API can tell released versions apart.
enum TranClientIdentity {
    /// The product version `pnpm release` owns (ADR-0034), from the bundle.
    static func version(bundle: Bundle = .main) -> String {
        (bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
    }

    /// The `X-Tran-Client` value.
    static func header(bundle: Bundle = .main) -> String {
        formatClient(platform: .ios, version: version(bundle: bundle))
    }

    static let current = header()
}

/// What an answer said about this version (REQ-VER-005, REQ-VER-006): blocked, or nudged.
enum TranStandingSignal: Equatable, Sendable {
    /// `426` / `client.upgrade_required`: the blocking update screen (REQ-VER-009).
    case upgradeRequired
    /// `X-Tran-Update: recommended`, with `X-Tran-Recommended-Version` when the server named it.
    case updateRecommended(version: String?)

    /// A failure that means "update" wins over any header; otherwise the headers decide.
    static func from(_ response: HTTPURLResponse, failure: TranRequestFailure?) -> TranStandingSignal? {
        if response.statusCode == 426 || failure?.code == .clientUpgradeRequired { return .upgradeRequired }
        guard response.value(forHTTPHeaderField: ApiContract.updateHeader) == ApiContract.updateRecommended
        else { return nil }
        return .updateRecommended(version: response.value(forHTTPHeaderField: ApiContract.recommendedVersionHeader))
    }
}

/// The one place every API request is built and sent, for both the API client and the session
/// client (and through it the push registration): the path from `TranEndpoint` (REQ-VER-001), the
/// `X-Tran-Client` header (REQ-VER-004), and what each answer says about this version handed to
/// `onStanding` (REQ-VER-009, REQ-VER-010). Failures are classified, never logged, here.
struct TranHttp: Sendable {
    let baseUrl: URL
    let session: URLSession
    /// The `X-Tran-Client` value.
    var client: String = TranClientIdentity.current
    /// Told whenever an answer blocks or nudges this version; the app's `TranUpdateCenter` by default.
    var onStanding: @Sendable (TranStandingSignal) -> Void = TranUpdateCenter.post

    /// A request for `endpoint`, with a JSON body and a bearer token when given.
    func request(
        _ endpoint: TranEndpoint, installationId: String? = nil, body: Data? = nil, bearer: String? = nil
    ) -> URLRequest {
        var request = URLRequest(url: baseUrl.appending(path: endpoint.path(installationId: installationId)))
        request.httpMethod = endpoint.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(client, forHTTPHeaderField: ApiContract.clientHeader)
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        return request
    }

    /// Sends `request`; a `2xx` returns its body, anything else throws a classified
    /// `TranRequestFailure`. A failure carries the fixed `LOG_EVENT` fields only, never a header or
    /// a body, so no token can reach a log or a report (REQ-SEC-014).
    func send(_ request: URLRequest) async throws -> Data {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw TranRequestFailure.classify(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw TranRequestFailure(code: .clientUnexpected)
        }
        let failure = (200..<300).contains(http.statusCode) ? nil : TranRequestFailure.rejected(http, body: data)
        if let signal = TranStandingSignal.from(http, failure: failure) { onStanding(signal) }
        if let failure { throw failure }
        return data
    }
}
