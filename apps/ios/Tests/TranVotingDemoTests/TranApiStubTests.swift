// Verifies: REQ-LOAD-007 REQ-VER-009
import XCTest

/// The debug-only transport stubs behind the pending screenshots and UI tests: a request that never
/// answers, so a check is held open past the indicator delay without a live API; and an API that
/// no longer serves this version, for the `upgrade_required` given.
final class TranApiStubTests: XCTestCase {
    private func defaults(_ stub: String?) -> UserDefaults {
        let defaults = UserDefaults(suiteName: "TranApiStubTests")!
        defaults.removePersistentDomain(forName: "TranApiStubTests")
        if let stub { defaults.set(stub, forKey: TranApiStub.key) }
        return defaults
    }

    func testOnlyTheNamedStubsInstallAProtocol() {
        XCTAssertTrue(TranApiStub.protocolClasses(defaults: defaults(nil)).isEmpty)
        XCTAssertTrue(TranApiStub.protocolClasses(defaults: defaults("")).isEmpty)
        XCTAssertTrue(TranApiStub.protocolClasses(defaults: defaults("refuse")).isEmpty)
        let classes = TranApiStub.protocolClasses(defaults: defaults("hang"))
        XCTAssertEqual(classes.count, 1)
        XCTAssertTrue(classes.first == TranHangingURLProtocol.self)
        let upgrade = TranApiStub.protocolClasses(defaults: defaults("upgrade_required"))
        XCTAssertEqual(upgrade.count, 1)
        XCTAssertTrue(upgrade.first == TranUpgradeRequiredURLProtocol.self)
    }

    /// Every product route answers `426 client.upgrade_required`; health still answers.
    func testTheUpgradeRequiredStubBlocksProductRoutesOnly() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TranUpgradeRequiredURLProtocol.self]
        let signals = SignalLog()
        let client = TranApiClient(
            baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: URLSession(configuration: configuration),
            retry: TranRetry(sleep: { _ in }, random: { 0 }),
            onStanding: signals.record)

        try await client.checkHealth()
        do {
            try await client.confirmEligibility(age: 20, countryCode: "NP")
            XCTFail("a product route must answer 426")
        } catch let failure as TranRequestFailure {
            XCTAssertEqual(failure.code, .clientUpgradeRequired)
            XCTAssertEqual(failure.status, 426)
            XCTAssertEqual(failure.spec.presentation, .screen)
            XCTAssertFalse(failure.spec.retryable, "sent once: a 426 is not retried")
        }
        XCTAssertEqual(signals.entries, [.upgradeRequired])
    }

    func testAHangingRequestNeverAnswersAndEndsWhenCancelled() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TranHangingURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let request = Task {
            try await session.data(from: URL(string: "http://127.0.0.1:3001" + ApiContract.healthPath)!)
        }
        request.cancel()
        do {
            _ = try await request.value
            XCTFail("a hanging request must never answer")
        } catch {
            XCTAssertEqual(TranRequestFailure.classify(error).code, .requestCancelled)
        }
    }
}
