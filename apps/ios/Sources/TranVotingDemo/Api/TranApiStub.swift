import Foundation

/// Debug-only transport stubs for the UI and screenshot suites (REQ-LOAD-007, ADR-0035).
/// `-TranApiStub hang` holds every request open until the per-attempt timeout or a cancellation,
/// so a check stays pending without a live API. ATS rejects plain HTTP to a non-local address on
/// iOS 27, so an unroutable address (RFC 5737 TEST-NET) fails at once instead of stalling.
/// A release build never installs a stub.
enum TranApiStub {
    static let key = "TranApiStub"

    static func protocolClasses(defaults: UserDefaults = .standard) -> [AnyClass] {
        #if DEBUG
            if defaults.string(forKey: key) == "hang" { return [TranHangingURLProtocol.self] }
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
#endif
