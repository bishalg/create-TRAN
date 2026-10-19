import SwiftUI

/// Full-bleed screen container: palette background behind the content, safe areas ignored.
struct TranScreen<Content: View>: View {
    @Environment(\.tranPalette) private var palette
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            palette.background.ignoresSafeArea()
            content
        }
    }
}

/// Vertical stack with a named gap step from the generated scale.
struct TranStack<Content: View>: View {
    var gap: TranGap = .md
    var alignment: HorizontalAlignment = .center
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: alignment, spacing: gap.value) { content }
    }
}

/// Horizontal row with a named gap step.
struct TranInline<Content: View>: View {
    var gap: TranGap = .sm
    var alignment: VerticalAlignment = .center
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: alignment, spacing: gap.value) { content }
    }
}

/// Padding wrapper with token steps (web `TranBox` padding union).
enum TranBoxPadding: CaseIterable {
    case none
    case sm
    case md
    case lg

    var value: CGFloat {
        switch self {
        case .none: return 0
        case .sm: return TranSpace.sm
        case .md: return TranSpace.md
        case .lg: return TranSpace.lg
        }
    }
}

struct TranBox<Content: View>: View {
    var padding: TranBoxPadding = .none
    @ViewBuilder var content: Content

    var body: some View {
        content.padding(padding.value)
    }
}

/// Surface variants mirroring the web `TranSurface`: `default` is the translucent card,
/// `raised` the opaque panel, `field` the input background.
enum TranSurfaceVariant: CaseIterable {
    case `default`
    case raised
    case field
}

enum TranSurfaceRadius: CaseIterable {
    case sm
    case md
    case lg

    var value: CGFloat {
        switch self {
        case .sm: return TranRadius.sm
        case .md: return TranRadius.md
        case .lg: return TranRadius.lg
        }
    }
}

struct TranSurface<Content: View>: View {
    @Environment(\.tranPalette) private var palette

    var surface: TranSurfaceVariant = .default
    var radius: TranSurfaceRadius = .md
    var padding: TranBoxPadding = .md
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding.value)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: radius.value))
    }

    private var background: Color {
        switch surface {
        case .default: return palette.surface.opacity(0.4)
        case .raised, .field: return palette.surface
        }
    }
}

/// Separator line bound to the palette instead of the system default.
struct TranDivider: View {
    @Environment(\.tranPalette) private var palette

    var body: some View {
        Divider().overlay(palette.textPrimary.opacity(0.2))
    }
}
