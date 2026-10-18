# Design System & UI Guide

This guide establishes the visual excellence, token integration, and accessibility guidelines for iOS apps. It combines tokenization patterns from **create-TRAN** and **Element X (`compound-ios`)** with modern Apple Human Interface Guidelines and the "Liquid Glass" design aesthetic.

---

## 1. Design Token Consumption

Design tokens must originate from a single source of truth (e.g. `crates/rust-core/src/tokens.rs` synchronized via `pnpm tokens:sync` into `BrandTokens.swift`). Never hardcode hex values or magic spacing numbers in UI views.

### Token Contract Example
```swift
import SwiftUI

public enum BrandTokens {
    public struct Palette {
        public static let primary = Color(hex: "#2B5BF7")
        public static let success = Color(hex: "#10B981")
        public static let error = Color(hex: "#EF4444")
        public static let glassSurfaceDark = Color.white.opacity(0.08)
        public static let glassBorderDark = Color.white.opacity(0.12)
    }

    public struct Spacing {
        public static let xs: CGFloat = 4
        public static let sm: CGFloat = 8
        public static let md: CGFloat = 16
        public static let lg: CGFloat = 24
        public static let xl: CGFloat = 32
    }

    public struct Radius {
        public static let sm: CGFloat = 8
        public static let md: CGFloat = 16
        public static let lg: CGFloat = 24
    }
}
```

---

## 2. Liquid Glass Aesthetic

The Liquid Glass design language combines translucent materials, subtle specular borders, and continuous corner curves (`RoundedCornerStyle.continuous`) to deliver a modern, native iOS feel.

### `GlassCard` Reference Implementation

```swift
import SwiftUI

public struct GlassCard<Content: View>: View {
    private let content: Content
    private let cornerRadius: CGFloat

    public init(cornerRadius: CGFloat = BrandTokens.Radius.md, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.content = content()
    }

    public var body: some View {
        content
            .padding(BrandTokens.Spacing.md)
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.ultraThinMaterial)
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.2),
                                Color.white.opacity(0.05)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .shadow(color: Color.black.opacity(0.1), radius: 10, x: 0, y: 5)
    }
}
```

### `GlassInput` Reference Implementation

```swift
import SwiftUI

public struct GlassInput: View {
    let titleKey: LocalizedStringKey
    @Binding var text: String
    var icon: String? = nil

    public init(_ titleKey: LocalizedStringKey, text: Binding<String>, icon: String? = nil) {
        self.titleKey = titleKey
        self._text = text
        self.icon = icon
    }

    public var body: some View {
        HStack(spacing: BrandTokens.Spacing.sm) {
            if let icon {
                Image(systemName: icon)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            TextField(titleKey, text: $text)
                .textFieldStyle(.plain)
        }
        .padding(.horizontal, BrandTokens.Spacing.md)
        .padding(.vertical, BrandTokens.Spacing.sm + 4)
        .background {
            RoundedRectangle(cornerRadius: BrandTokens.Radius.sm, style: .continuous)
                .fill(.thinMaterial)
        }
        .overlay {
            RoundedRectangle(cornerRadius: BrandTokens.Radius.sm, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
        }
        .frame(minHeight: 44) // Meets HIG minimum touch target
    }
}
```

---

## 3. Accessibility & Dynamic Type Standards

Every production screen must be tested against accessibility criteria:

1. **Minimum Touch Targets**: All interactive controls must measure at least 44x44pt.
2. **Dynamic Type Support**: Font sizes must scale with the user's preferred text size using `@ScaledMetric` or semantic text styles (`.font(.headline)`).
3. **VoiceOver Semantics**: Use `.accessibilityElement(children: .combine)` and provide descriptive `.accessibilityLabel` and `.accessibilityHint` values:

```swift
struct StatCardView: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title2.weight(.bold))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): \(value)")
    }
}
```

---

## 4. Haptic Feedback

Integrate subtle haptics to confirm user actions:

```swift
Button("Cast Ballot") {
    viewModel.submit()
}
.sensoryFeedback(.success, trigger: viewModel.isSuccess)
.sensoryFeedback(.error, trigger: viewModel.isFailure)
```
