// Verifies: REQ-ERR-011 REQ-ERR-014 REQ-OBS-011
import Foundation

/// The one seam for "a human must look at this" (ADR-0036): `error`-level failures and uncaught
/// exceptions go to `sink` — Crashlytics, Sentry or an HTTP endpoint in a real app; none in the
/// template, so nothing leaves the device. Set it once, at launch, before any other thread runs.
enum TranReporting {
    /// Exactly the `logEvent` fields — never a payload (REQ-OBS-002, REQ-OBS-011).
    struct Event: Equatable, Sendable {
        let code: String
        let status: Int?
        let requestId: String?
        let traceId: String?

        init(code: String, status: Int? = nil, requestId: String? = nil, traceId: String? = nil) {
            self.code = code
            self.status = status
            self.requestId = requestId
            self.traceId = traceId
        }
    }

    /// Written once at launch, read afterwards; the crash handler may read it from any thread.
    nonisolated(unsafe) static var sink: (@Sendable (Event, String?) -> Void)?

    /// Reports `failure` when the catalogue logs it at `error`; anything quieter is never reported.
    static func report(_ failure: TranRequestFailure, detail: String? = nil) {
        let spec = failure.spec
        guard isReportedLogLevel(level: spec.logLevel) else { return }
        // Only client-side codes may carry a detail (a crash reason), never a payload.
        let clientSide = spec.wireCode.hasPrefix("client.")
        sink?(
            Event(
                code: spec.wireCode,
                status: failure.status,
                requestId: failure.requestId,
                traceId: failure.traceId
            ),
            clientSide ? detail : nil
        )
    }

    /// The handler that was installed before ours; we report, then hand over (REQ-ERR-011).
    nonisolated(unsafe) private static var previous: NSUncaughtExceptionHandler?

    /// Reports an uncaught Objective-C exception as `client.unexpected`, then lets the previous
    /// handler (or the system) end the process. Swift traps cannot be caught; a crash reporter
    /// SDK picks those up on the next launch. SwiftUI cannot recover a broken view tree, so there
    /// is no `screen` presentation on iOS.
    static func installUncaughtExceptionHandler() {
        previous = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler { exception in
            TranReporting.report(
                TranRequestFailure(code: .clientUnexpected),
                detail: "\(exception.name.rawValue): \(exception.description)"
            )
            TranReporting.previous?(exception)
        }
    }
}
