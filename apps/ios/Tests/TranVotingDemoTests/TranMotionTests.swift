// Verifies: REQ-NAT-006 REQ-LOAD-006
import SwiftUI
import XCTest

final class TranMotionTests: XCTestCase {
    func testReduceMotionDisablesSessionTransitions() {
        XCTAssertNil(TranMotion.animation(reduceMotion: true))
        XCTAssertNotNil(TranMotion.animation(reduceMotion: false))
    }

    func testTheAnimationDurationIsTheGeneratedToken() {
        // [REQ-LOAD-006] the animation duration is the generated token
        XCTAssertEqual(
            TranMotion.animation(reduceMotion: false),
            .easeOut(duration: TranMotionDuration.base)
        )
        XCTAssertNotEqual(
            TranMotion.animation(reduceMotion: false),
            .easeOut(duration: TranMotionDuration.fast)
        )
    }
}
