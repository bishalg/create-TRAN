// Verifies: REQ-CFG-002 REQ-CFG-005 REQ-CFG-006 REQ-CFG-007 REQ-CFG-008
import XCTest
@testable import TranVotingDemo

final class RemoteConfigTests: XCTestCase {
    private let suite = "RemoteConfigTests"
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    func testStartsWithCompiledDefaultsWhenStorageIsEmpty() {
        let store = RemoteConfigStore(userDefaults: defaults)
        XCTAssertFalse(store.isNotifyMe)
        XCTAssertEqual(store.version, 1)
        XCTAssertNil(store.thresholds.minimum)
        XCTAssertNil(store.thresholds.recommended)
    }

    func testStartsWithStoredConfigurationWhenPresent() throws {
        let json: [String: Any] = [
            "config_version": 3,
            "flags": [Flags.notifyMeId: true],
            "client": [
                "minimum_version": "1.4.0",
                "recommended_version": "1.5.0"
            ]
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        defaults.set(data, forKey: "tran.remote_config")

        let store = RemoteConfigStore(userDefaults: defaults)
        XCTAssertTrue(store.isNotifyMe)
        XCTAssertEqual(store.version, 3)
        XCTAssertEqual(store.thresholds.minimum, "1.4.0")
        XCTAssertEqual(store.thresholds.recommended, "1.5.0")
    }

    func testFetchWithoutBaseUrlReturnsFalseSafely() async {
        let store = RemoteConfigStore(userDefaults: defaults, baseUrl: nil)
        let result = await store.fetchInBackground(clientHeader: "ios/1.0.0", bucket: 10)
        XCTAssertFalse(result)
        XCTAssertFalse(store.isNotifyMe)
    }
}
