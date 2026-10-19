import SwiftUI

/// Motion policy for session transitions: with Reduce Motion on, nothing animates.
/// Screens never touch `withAnimation` directly.
enum TranMotion {
    static func animation(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .default
    }
}
