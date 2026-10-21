// Verifies: REQ-NAT-012
import XCTest

final class TranReferenceDateTests: XCTestCase {
    /// 2026-10-20 23:30 UTC — late enough that a local-time formatter east of UTC rolls to the 21st.
    private let date = Date(timeIntervalSince1970: 1_792_539_000)

    func testIsIsoInUtc() {
        XCTAssertEqual(TranReferenceDate.string(from: date), "2026-10-20")
    }

    /// The bug the screenshots found: a formatter that follows the locale is not ISO.
    func testALocaleFollowingFormatterIsNotIsoInNepali() {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.locale = Locale(identifier: "ne")
        XCTAssertNotEqual(formatter.string(from: date), "2026-10-20")
    }

    func testRustAcceptsItWhateverTheLocale() throws {
        let result = try evaluateVoteEligibilityOffline(
            age: 20,
            birthdateIso: nil,
            countryCode: "NP",
            referenceDateIso: TranReferenceDate.string(from: date)
        )
        XCTAssertTrue(result.eligible)
    }
}
