// Verifies: REQ-LOAD-007
import XCTest

/// The debug-only transport stub behind the pending screenshots and UI tests: a request that never
/// answers, so a check is held open past the indicator delay without a live API.
final class TranApiStubTests: XCTestCase {
    private func defaults(_ stub: String?) -> UserDefaults {
        let defaults = UserDefaults(suiteName: "TranApiStubTests")!
        defaults.removePersistentDomain(forName: "TranApiStubTests")
        if let stub { defaults.set(stub, forKey: TranApiStub.key) }
        return defaults
    }

    func testOnlyTheHangStubInstallsAProtocol() {
        XCTAssertTrue(TranApiStub.protocolClasses(defaults: defaults(nil)).isEmpty)
        XCTAssertTrue(TranApiStub.protocolClasses(defaults: defaults("")).isEmpty)
        XCTAssertTrue(TranApiStub.protocolClasses(defaults: defaults("refuse")).isEmpty)
        let classes = TranApiStub.protocolClasses(defaults: defaults("hang"))
        XCTAssertEqual(classes.count, 1)
        XCTAssertTrue(classes.first == TranHangingURLProtocol.self)
    }

    func testAHangingRequestNeverAnswersAndEndsWhenCancelled() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TranHangingURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let request = Task {
            try await session.data(from: URL(string: "http://127.0.0.1:3001/api/health")!)
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
