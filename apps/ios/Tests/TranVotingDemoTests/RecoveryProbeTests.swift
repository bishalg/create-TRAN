// Verifies: REQ-ERR-013
import XCTest

/// The connectivity banner's recovery loop: Rust schedule, nudges, one probe at a time, silent stop.
@MainActor
final class RecoveryProbeTests: XCTestCase {
    private struct Down: Error {}

    func testProbesOnTheScheduleUntilOneSucceeds() async {
        let probe = RecoveryProbe()
        let waits = Recorder<UInt64>()
        probe.sleep = { ms in waits.add(ms) }
        let attempts = Recorder<Void>()
        let recovered = expectation(description: "recovered")
        probe.start(
            probe: {
                attempts.add(())
                if attempts.items.count < 3 { throw Down() }
            },
            onRecovered: { recovered.fulfill() }
        )
        await fulfillment(of: [recovered], timeout: 2)
        XCTAssertEqual(attempts.items.count, 3)
        XCTAssertEqual(waits.items, [1, 2, 3].map { recoveryProbeDelayMs(probe: $0) })
        XCTAssertFalse(probe.isRunning)
    }

    func testNudgeProbesAtOnceInsteadOfWaiting() async {
        let probe = RecoveryProbe()
        // A wait that only ends by cancellation: only the nudge can start a probe.
        probe.sleep = { _ in try await Task.sleep(for: .seconds(86_400)) }
        let recovered = expectation(description: "recovered")
        probe.start(probe: {}, onRecovered: { recovered.fulfill() })
        probe.nudge()
        await fulfillment(of: [recovered], timeout: 2)
    }

    func testStopSilencesEverything() async {
        let probe = RecoveryProbe()
        probe.sleep = { _ in try await Task.sleep(for: .seconds(86_400)) }
        let calls = Recorder<String>()
        probe.start(probe: { calls.add("probe") }, onRecovered: { calls.add("recovered") })
        probe.stop()
        XCTAssertNil(probe.nudge(), "nothing to recover after stop")
        await Task.yield()
        XCTAssertEqual(calls.items, [])
        XCTAssertFalse(probe.isRunning)
    }

    func testAStoppedProbeThatFinishesLateDoesNotFreeANewerRun() async {
        let probe = RecoveryProbe()
        probe.sleep = { _ in try await Task.sleep(for: .seconds(86_400)) }
        let calls = Recorder<String>()
        // P1 ignores cancellation, like a request that is still unwinding.
        var finishFirst: CheckedContinuation<Void, Never>?
        probe.start(
            probe: {
                calls.add("p1")
                await withCheckedContinuation { finishFirst = $0 }
            },
            onRecovered: {}
        )
        let first = probe.nudge()
        while finishFirst == nil { await Task.yield() }
        probe.stop()
        probe.start(probe: { calls.add("p2"); try await Task.sleep(for: .seconds(86_400)) }, onRecovered: {})
        probe.nudge()
        while calls.items.count < 2 { await Task.yield() }
        finishFirst?.resume()
        await first?.value
        // P2 is still in flight, so this nudge must not start P3.
        XCTAssertNil(probe.nudge())
        XCTAssertEqual(calls.items, ["p1", "p2"])
        probe.stop()
    }
}
