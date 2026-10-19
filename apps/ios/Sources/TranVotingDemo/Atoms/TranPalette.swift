import SwiftUI

/// Atoms read the active palette from the environment, mirroring the web layer where tokens
/// arrive as CSS variables instead of props. The root coordinator injects the registry palette.
private struct TranPaletteKey: EnvironmentKey {
    static let defaultValue = TranBrandTokens.dark
}

extension EnvironmentValues {
    var tranPalette: TranPalette {
        get { self[TranPaletteKey.self] }
        set { self[TranPaletteKey.self] = newValue }
    }
}
