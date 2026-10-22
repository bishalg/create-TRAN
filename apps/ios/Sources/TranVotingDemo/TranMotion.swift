import SwiftUI

/// Motion policy for session transitions and the verdict caption: one ease-out at the generated
/// `TranMotionDuration.base` (REQ-LOAD-006); with Reduce Motion on, nothing animates.
/// Screens never pick an animation or a duration themselves.
enum TranMotion {
    static func animation(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeOut(duration: TranMotionDuration.base)
    }
}
