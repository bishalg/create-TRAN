// Verifies: REQ-LOAD-002 REQ-LOAD-004 REQ-LOAD-005
import XCTest

/// A suspension point the test opens by hand, so no test ever waits on a real clock.
@MainActor
private final class Gate {
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private(set) var isOpen = false
    private(set) var waitedFor: [UInt64] = []

    func wait(_ ms: UInt64 = 0) async {
        waitedFor.append(ms)
        if isOpen { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func open() {
        isOpen = true
        waiters.forEach { $0.resume() }
        waiters.removeAll()
    }
}

/// The background server confirmation behind the native verdict: delayed indicator, one task,
/// newest wins, cancelled is silent (ADR-0035).
@MainActor
final class ServerConfirmationTests: XCTestCase {
    private var gates: [Gate] = []

    override func tearDown() async throws {
        // Release every suspended fake so no continuation leaks past the test.
        gates.forEach { $0.open() }
        gates.removeAll()
    }

    private func gate() -> Gate {
        let gate = Gate()
        gates.append(gate)
        return gate
    }

    /// A confirmation whose indicator delay is held by `clock`.
    private func confirmation(clock: Gate) -> ServerConfirmation {
        let confirmation = ServerConfirmation()
        confirmation.sleep = { ms in await clock.wait(ms) }
        return confirmation
    }

    /// Lets the main actor run the tasks a gate just resumed; yields only, never sleeps.
    private func drain() async {
        for _ in 0..<20 { await Task.yield() }
    }

    func testIndicatorWaitsForThePolicyDelay() async {
        let clock = gate()
        let confirmation = confirmation(clock: clock)
        let answer = gate()
        confirmation.start { await answer.wait() }
        await drain()
        XCTAssertEqual(clock.waitedFor, [loadingPolicy().indicatorDelayMs])
        answer.open()
    }

    func testIsPendingIsFalseForARunThatFinishesBeforeTheDelay() async {
        // [REQ-LOAD-002] isPending is false for a run that finishes before the delay
        let clock = gate()
        let confirmation = confirmation(clock: clock)
        var outcomes: [ServerConfirmation.Outcome] = []
        let run = confirmation.start({}, onFinish: { outcomes.append($0) })
        XCTAssertFalse(confirmation.isPending)
        await run.value
        XCTAssertFalse(confirmation.isPending)
        XCTAssertEqual(outcomes, [.confirmed])

        clock.open()  // the delay elapses after the answer: still no indicator
        await drain()
        XCTAssertFalse(confirmation.isPending)
        XCTAssertEqual(confirmation.caption, L10n.Eligibility.resultSourceServer)
    }

    func testIsPendingTurnsTrueAfterTheDelayAndFalseWhenTheRunSettles() async {
        // [REQ-LOAD-002] isPending turns true after the delay and false when the run settles
        let clock = gate()
        let confirmation = confirmation(clock: clock)
        let answer = gate()
        let run = confirmation.start { await answer.wait() }
        await drain()
        XCTAssertFalse(confirmation.isPending, "no indicator before the delay")
        XCTAssertEqual(confirmation.caption, L10n.Eligibility.resultSourceDevice)

        clock.open()
        await drain()
        XCTAssertTrue(confirmation.isPending)
        XCTAssertEqual(confirmation.caption, L10n.Eligibility.resultUpdating)

        answer.open()
        await run.value
        XCTAssertFalse(confirmation.isPending)
        XCTAssertEqual(confirmation.phase, .confirmed)
        XCTAssertEqual(confirmation.caption, L10n.Eligibility.resultSourceServer)
    }

    func testIndicatorClearsWhenTheRunFails() async {
        // [REQ-LOAD-002] the indicator disappears on a failure too
        let clock = gate()
        clock.open()
        let confirmation = confirmation(clock: clock)
        let answer = gate()
        let run = confirmation.start {
            await answer.wait()
            throw TranRequestFailure(code: .serverInternal, status: 500)
        }
        await drain()
        XCTAssertTrue(confirmation.isPending)
        answer.open()
        await run.value
        XCTAssertFalse(confirmation.isPending)
        XCTAssertEqual(confirmation.phase, .failed(TranRequestFailure(code: .serverInternal, status: 500)))
    }

    func testStartCancelsThePreviousRunAndItsResultNeverLands() async {
        // [REQ-LOAD-004] start cancels the previous run and its result never lands
        let clock = gate()
        let confirmation = confirmation(clock: clock)
        let slow = gate()
        var outcomes: [String] = []
        let first = confirmation.start({
            await slow.wait()
            throw TranRequestFailure(code: .serverInternal)
        }, onFinish: { outcomes.append("first \($0)") })
        await drain()

        let second = confirmation.start({}, onFinish: { outcomes.append("second \($0)") })
        await second.value
        XCTAssertEqual(confirmation.phase, .confirmed)

        slow.open()  // the late answer arrives after the newer one
        await first.value
        clock.open()  // and the superseded run's delay elapses
        await drain()
        XCTAssertEqual(confirmation.phase, .confirmed, "a superseded answer must not replace the newer one")
        XCTAssertFalse(confirmation.isPending)
        XCTAssertEqual(outcomes, ["second confirmed", "first cancelled"])
    }

    func testCancelLeavesThePhaseUntouched() async {
        // [REQ-LOAD-004] cancel leaves the phase untouched
        let clock = gate()
        clock.open()
        let confirmation = confirmation(clock: clock)
        await confirmation.start {}.value
        XCTAssertEqual(confirmation.phase, .confirmed)

        let answer = gate()
        var outcomes: [ServerConfirmation.Outcome] = []
        let run = confirmation.start({
            await answer.wait()
            throw TranRequestFailure(code: .networkOffline)
        }, onFinish: { outcomes.append($0) })
        await drain()
        XCTAssertTrue(confirmation.isPending)

        confirmation.cancel()
        XCTAssertFalse(confirmation.isPending, "leaving clears the indicator at once")
        answer.open()
        await run.value
        XCTAssertEqual(confirmation.phase, .idle, "a cancelled check shows nothing new")
        XCTAssertEqual(confirmation.source, .device)
        XCTAssertEqual(outcomes, [.cancelled])
    }

    func testARequestCancelledFailureIsSilent() async {
        // [REQ-LOAD-004] a cancelled transport (`request.cancelled`) is not a failure to show
        let clock = gate()
        let confirmation = confirmation(clock: clock)
        var outcomes: [ServerConfirmation.Outcome] = []
        await confirmation.start({ throw URLError(.cancelled) }, onFinish: { outcomes.append($0) }).value
        XCTAssertEqual(confirmation.phase, .idle)
        XCTAssertEqual(outcomes, [.cancelled])
    }

    func testABannerFailureMapsToDeviceFallbackAndSuccessToServer() {
        // [REQ-LOAD-005] a banner failure maps to deviceFallback, success to server
        typealias Phase = ServerConfirmation.Phase
        XCTAssertEqual(ServerConfirmation.source(for: .idle), .device)
        XCTAssertEqual(ServerConfirmation.source(for: .confirmed), .server)
        XCTAssertEqual(
            ServerConfirmation.source(for: .failed(TranRequestFailure(code: .networkOffline))),
            .deviceFallback)
        XCTAssertEqual(
            ServerConfirmation.source(for: .failed(TranRequestFailure(code: .networkTimeout))),
            .deviceFallback)
        // A retryable server failure, once the retries are spent, also leaves the device to decide.
        XCTAssertEqual(
            ServerConfirmation.source(for: .failed(TranRequestFailure(code: .serverInternal))),
            .deviceFallback)
        // The server answered and refused: nobody vouched beyond the device.
        XCTAssertEqual(
            ServerConfirmation.source(for: .failed(TranRequestFailure(code: .validationInvalidDate))),
            .device)
    }

    func testEverySourceCaptionIsTheCatalogueLabel() async {
        // [REQ-LOAD-005] the fallback is labelled distinctly from device and server
        let clock = gate()
        let confirmation = confirmation(clock: clock)
        await confirmation.start { throw TranRequestFailure(code: .networkOffline) }.value
        XCTAssertEqual(confirmation.source, .deviceFallback)
        XCTAssertEqual(confirmation.caption, L10n.Eligibility.resultSourceFallback)
        let labels = Set([TranVerdictSource.device, .server, .deviceFallback].map {
            TranFeedback.message(verdictSourceSpec(source: $0).messageKey)
        })
        XCTAssertEqual(labels.count, 3)

        // A later successful check returns the source to the server.
        await confirmation.start {}.value
        XCTAssertEqual(confirmation.source, .server)
    }

    func testStartResetsTheSourceForTheNewDeviceVerdict() async {
        // [REQ-LOAD-005] a new device verdict is not vouched for by the previous server answer
        let clock = gate()
        let confirmation = confirmation(clock: clock)
        await confirmation.start {}.value
        XCTAssertEqual(confirmation.source, .server)
        let answer = gate()
        confirmation.start { await answer.wait() }
        XCTAssertEqual(confirmation.source, .device)
        answer.open()
    }
}
