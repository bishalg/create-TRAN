import Network

/// Yields each time the device regains a usable network path, so a connectivity banner can probe
/// at once instead of waiting for the next scheduled probe (REQ-ERR-013).
enum TranConnectivity {
    static func becameReachable() -> AsyncStream<Void> {
        AsyncStream { continuation in
            let monitor = NWPathMonitor()
            let last = LastPath()
            monitor.pathUpdateHandler = { path in
                let reachable = path.status == .satisfied
                // The first update only reports the current state; react to changes back to online.
                if reachable, last.reachable == false { continuation.yield() }
                last.reachable = reachable
            }
            continuation.onTermination = { _ in monitor.cancel() }
            monitor.start(queue: DispatchQueue(label: "com.tran.voting.connectivity"))
        }
    }
}

/// Touched only on the monitor's serial queue.
private final class LastPath: @unchecked Sendable {
    var reachable: Bool?
}
