import Foundation

/// Debug-only transport stubs for the UI and screenshot suites (REQ-LOAD-007, ADR-0035).
/// `-TranApiStub hang` holds every request open until the per-attempt timeout or a cancellation,
/// so a check stays pending without a live API. ATS rejects plain HTTP to a non-local address on
/// iOS 27, so an unroutable address (RFC 5737 TEST-NET) fails at once instead of stalling.
/// `-TranApiStub upgrade_required` stages the screen contract's `upgrade_required` given
/// (REQ-VER-009): every product route answers `426 client.upgrade_required` while health answers.
/// A release build never installs a stub.
enum TranApiStub {
    static let key = "TranApiStub"

    static func protocolClasses(defaults: UserDefaults = .standard) -> [AnyClass] {
        #if DEBUG
            switch defaults.string(forKey: key) {
            case "hang": return [TranHangingURLProtocol.self]
            case "upgrade_required": return [TranUpgradeRequiredURLProtocol.self]
            default: break
            }
        #endif
        return []
    }
}

#if DEBUG
    /// Accepts every request and never answers; URLSession ends it by timeout or cancellation.
    final class TranHangingURLProtocol: URLProtocol {
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {}
        override func stopLoading() {}
    }

    /// An API that no longer serves this version: `426` with the `client.upgrade_required`
    /// envelope on every product route, as `apps/api` answers below the minimum; health is exempt.
    final class TranUpgradeRequiredURLProtocol: URLProtocol {
        static let envelope = Data(
            #"{"success":false,"error":"This app version is no longer supported; update the app","code":"client.upgrade_required","retryable":false,"request_id":"stub-upgrade-required"}"#
                .utf8)

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            guard let url = request.url else { return }
            let health = url.path == TranEndpoint.checkHealth.path()
            let response = HTTPURLResponse(
                url: url, statusCode: health ? 200 : 426, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: health ? Data("{}".utf8) : Self.envelope)
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }
#endif
