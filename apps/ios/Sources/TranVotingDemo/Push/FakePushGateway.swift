#if DEBUG
    // Verifies: REQ-PSH-008 REQ-PSH-012
    import Foundation

    /// A push gateway with no APNs behind it: the unit tests script it, and the debug launch
    /// presets use it (`TranPushLaunch`), so no test needs a real token. It records each request
    /// for a token. Compiled into debug builds only.
    @MainActor
    final class FakePushGateway: PushGateway {
        var isAvailable: Bool
        var token: String?
        /// The token a request delivers; `nil` delivers none, like a system that never answers.
        var tokenOnRegister: String?
        var onEvent: ((TranPushEvent) -> Void)? {
            didSet { flush() }
        }

        private(set) var registrations = 0
        private var pending: [TranPushEvent] = []

        init(available: Bool, token: String? = nil, tokenOnRegister: String? = nil) {
            self.isAvailable = available
            self.token = token
            self.tokenOnRegister = tokenOnRegister
        }

        func registerForPush() {
            registrations += 1
            guard let tokenOnRegister else { return }
            token = tokenOnRegister
            deliver(.tokenArrived)
        }

        /// What the system would report: a rotated token, a tap, a foreground notification.
        func deliver(_ event: TranPushEvent) {
            pending.append(event)
            flush()
        }

        private func flush() {
            guard let onEvent else { return }
            let events = pending
            pending = []
            events.forEach(onEvent)
        }
    }
#endif
