// Verifies: REQ-LOAD-002 REQ-LOAD-004 REQ-LOAD-005
import Foundation
import Observation

/// The server's background confirmation of the device verdict (ADR-0023, ADR-0035): one task at a
/// time, the newest wins, a cancelled run is silent, and the pending caption only appears once the
/// run outlives the Rust indicator delay (`loadingPolicy()`).
@MainActor
@Observable
final class ServerConfirmation {
    /// What the last settled run said. A cancelled run never changes it.
    enum Phase: Equatable {
        case idle
        case confirmed
        case failed(TranRequestFailure)
    }

    /// How one run ended, for the screen's toast, banner and status pill.
    enum Outcome: Equatable {
        case confirmed
        case failed(TranRequestFailure)
        /// Superseded by a newer run, cancelled on leaving, or `request.cancelled`: show nothing.
        case cancelled
    }

    private(set) var phase: Phase = .idle
    /// True only while a run has been in flight for longer than the indicator delay (REQ-LOAD-002).
    private(set) var isPending = false

    /// Injected in tests so the indicator delay never really waits (same shape as `TranRetry.sleep`).
    @ObservationIgnored var sleep: @Sendable (UInt64) async throws -> Void = { ms in
        try await Task.sleep(nanoseconds: ms * 1_000_000)
    }

    @ObservationIgnored private var running: Task<Void, Never>?
    @ObservationIgnored private var indicator: Task<Void, Never>?
    /// Bumped by every start and cancel; a task whose number is stale may not touch the state.
    @ObservationIgnored private var generation = 0

    /// Who vouches for the verdict on screen (REQ-LOAD-005).
    var source: TranVerdictSource { Self.source(for: phase) }

    /// The live caption under the verdict: the pending copy while pending, else the source label.
    var caption: String {
        let key =
            isPending
            ? loadingPolicy().pendingMessageKey
            : verdictSourceSpec(source: source).messageKey
        return TranFeedback.message(key)
    }

    /// The server answered → `server`; it could not answer (no route, timeout, or a retryable
    /// failure after the retries) → `device_fallback`; otherwise only the device vouched.
    nonisolated static func source(for phase: Phase) -> TranVerdictSource {
        switch phase {
        case .idle: return .device
        case .confirmed: return .server
        case let .failed(failure):
            if case .banner = failure.spec.presentation { return .deviceFallback }
            return failure.spec.retryable ? .deviceFallback : .device
        }
    }

    /// Cancels the run in flight and starts `run`. `onFinish` hears every ending, including
    /// `.cancelled`, after the state has been updated. The returned task lets tests await it.
    @discardableResult
    func start(
        _ run: @escaping @Sendable () async throws -> Void,
        onFinish: @escaping @MainActor (Outcome) -> Void = { _ in }
    ) -> Task<Void, Never> {
        cancel()
        // A new device verdict is on screen: nothing but the device vouches for it yet.
        phase = .idle
        let id = generation
        let delay = loadingPolicy().indicatorDelayMs
        let sleep = self.sleep
        indicator = Task { [weak self] in
            do { try await sleep(delay) } catch { return }
            guard let self, self.generation == id else { return }
            self.isPending = true
        }
        let task = Task { [weak self] in
            let outcome = await Self.outcome(of: run)
            guard let self, self.generation == id, !Task.isCancelled, outcome != .cancelled else {
                onFinish(.cancelled)
                return
            }
            self.stop()
            switch outcome {
            case .confirmed: self.phase = .confirmed
            case let .failed(failure): self.phase = .failed(failure)
            case .cancelled: break
            }
            onFinish(outcome)
        }
        running = task
        return task
    }

    /// Abandons the run in flight (leaving the screen, REQ-LOAD-004); the phase stays as it is.
    func cancel() {
        running?.cancel()
        stop()
    }

    private func stop() {
        generation += 1
        indicator?.cancel()
        indicator = nil
        running = nil
        isPending = false
    }

    private static func outcome(of run: @Sendable () async throws -> Void) async -> Outcome {
        do {
            try await run()
            return .confirmed
        } catch {
            let failure = TranRequestFailure.classify(error)
            return failure.code == .requestCancelled ? .cancelled : .failed(failure)
        }
    }
}
