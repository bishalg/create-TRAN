import Foundation
import SwiftUI

// MARK: - Safe Collection Access (NetNewsWire / RSCore Pattern)

public extension Collection {
    /// Returns the element at the specified index if it is within bounds, otherwise nil.
    /// Prevents 'index out of range' crashes in lists, carousels, and table views.
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

public extension Sequence where Element: Hashable {
    /// Returns an array with duplicate elements removed while maintaining original order.
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}

public extension Array {
    /// Chunks an array into smaller sub-arrays of specified size.
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [] }
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}

// MARK: - Thread-Safe Date & ISO8601 Formatters

public enum DateFormatters {
    /// Thread-safe cached ISO8601 formatter (with fractional seconds)
    public static let iso8601WithFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// Thread-safe cached standard ISO8601 formatter
    public static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    /// Cached date-only formatter (yyyy-MM-dd) in UTC
    public static let dateOnlyUTC: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()
}

public extension Date {
    /// Formats to standard ISO8601 string
    var iso8601String: String {
        DateFormatters.iso8601.string(from: self)
    }

    /// Formats to date-only string (yyyy-MM-dd)
    var dateOnlyUTCString: String {
        DateFormatters.dateOnlyUTC.string(from: self)
    }

    /// Parses an ISO8601 string
    static func from(iso8601: String) -> Date? {
        DateFormatters.iso8601WithFraction.date(from: iso8601) ?? DateFormatters.iso8601.date(from: iso8601)
    }
}

// MARK: - String Helpers

public extension String {
    /// Trims leading and trailing whitespace and newlines
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Returns true if the string is a valid email format
    var isValidEmail: Bool {
        let pattern = #"^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,64}$"#
        return range(of: pattern, options: .regularExpression) != nil
    }

    /// Safely masks all but the last visible characters (useful for hashes, keys, or cards)
    func masked(visibleTrailing: Int = 4, maskCharacter: Character = "•") -> String {
        guard count > visibleTrailing else { return self }
        let maskedCount = count - visibleTrailing
        let mask = String(repeating: maskCharacter, count: maskedCount)
        let trailing = suffix(visibleTrailing)
        return mask + trailing
    }
}

// MARK: - SwiftUI Color Hex Extension

public extension Color {
    /// Initializes a Color from a 6-digit or 8-digit hexadecimal string (e.g. "#2B5BF7" or "2B5BF7")
    init(hex: String) {
        let sanitized = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: sanitized).scanHexInt64(&int)

        let a, r, g, b: UInt64
        switch sanitized.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }

        self.init(
            .sRGB,
            red: Double(r) / 255.0,
            green: Double(g) / 255.0,
            blue: Double(b) / 255.0,
            opacity: Double(a) / 255.0
        )
    }
}
