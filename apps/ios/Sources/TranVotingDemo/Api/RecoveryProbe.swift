// Verifies: REQ-ERR-013
import Foundation

/// Asks the server whether it is back while a connectivity banner is up (REQ-ERR-013): on the Rust
/// schedule (`recoveryProbeDelayMs`), and at once on `nudge()` — the network returned or the app
/// came to the foreground. One probe at a time, no retries; `stop()` silences a probe in flight.
@MainActor
final class RecoveryProbe {
    /// Injected in tests so the schedule never really waits (same shape as `TranRetry.sleep`).
    var sleep: @Sendable (UInt64) async throws -> Void = { ms in
        try await Task.sleep(nanoseconds: ms * 1_000_000)
    }

    private var loop: Task<Void, Never>?
    private var probe: (@MainActor () async throws -> Void)?
    private var onRecovered: (@MainActor () -> Void)?
    private var probes: UInt32 = 0
    private var probing = false
    /// Bumped by every start and stop; a probe from an older run may not touch the state.
    private var generation = 0

    /// Whether a recovery is under way (a probe is scheduled or in flight).
    var isRunning: Bool { probe != nil }

    /// Starts probing with `probe`; `onRecovered` runs once, after the first probe that succeeds.
    /// The returned task is the first wait, so tests can await it.
    @discardableResult
    func start(
        probe: @escaping @MainActor () async throws -> Void,
        onRecovered: @escaping @MainActor () -> Void
    ) -> Task<Void, Never>? {
        stop()
        self.probe = probe
        self.onRecovered = onRecovered
        probes = 0
        schedule()
        return loop
    }

    /// Probes now, unless a probe is already in flight or nothing is being recovered.
    @discardableResult
    func nudge() -> Task<Void, Never>? {
        guard probe != nil, !probing else { return nil }
        loop?.cancel()
        loop = Task { [weak self] in await self?.runProbe() }
        return loop
    }

    /// Stops probing; a probe in flight may finish but changes nothing.
    func stop() {
        generation += 1
        loop?.cancel()
        loop = nil
        probe = nil
        onRecovered = nil
        probing = false
    }

    private func schedule() {
        let delay = recoveryProbeDelayMs(probe: probes + 1)
        let sleep = self.sleep
        loop = Task { [weak self] in
            do { try await sleep(delay) } catch { return }
            await self?.runProbe()
        }
    }

    private func runProbe() async {
        guard let probe, !Task.isCancelled else { return }
        let run = generation
        probing = true
        probes += 1
        let succeeded: Bool
        do {
            try await probe()
            succeeded = true
        } catch {
            succeeded = false
        }
        // An older run (stopped while its request unwound) must not touch a newer run's state.
        guard run == generation else { return }
        probing = false
        guard !Task.isCancelled else { return }
        if succeeded {
            let onRecovered = self.onRecovered
            stop()
            onRecovered?()
        } else {
            schedule()
        }
    }
}
