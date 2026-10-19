import CoreGraphics

/// Named gap steps from the generated spacing scale (`tokens.rs` → `TranSpace`).
/// Names match the web scale (`xxs…2xl`; `xxl` is the Swift-safe spelling of the web `2xl`).
/// The vocabulary is pinned to `tokens.json` by `native-atoms.test.ts`.
enum TranGap: CaseIterable {
    case xxs
    case xs
    case sm
    case base
    case md
    case lg
    case xl
    case xxl

    var value: CGFloat {
        switch self {
        case .xxs: return TranSpace.xxs
        case .xs: return TranSpace.xs
        case .sm: return TranSpace.sm
        case .base: return TranSpace.base
        case .md: return TranSpace.md
        case .lg: return TranSpace.lg
        case .xl: return TranSpace.xl
        case .xxl: return TranSpace.xxl
        }
    }
}
