import Foundation

/// The date the Rust core judges an age against (REQ-NAT-012).
enum TranReferenceDate {
    /// `YYYY-MM-DD` in UTC. ISO 8601 formatting ignores the device's language, digits and
    /// calendar; a `DateFormatter` follows them, and writes `२०२६-१०-२०` in Nepali.
    static func string(from date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }
}
