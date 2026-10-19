// Verifies: REQ-NAT-006
import XCTest

final class TranMotionTests: XCTestCase {
    func testReduceMotionDisablesSessionTransitions() {
        XCTAssertNil(TranMotion.animation(reduceMotion: true))
        XCTAssertNotNil(TranMotion.animation(reduceMotion: false))
    }
}
