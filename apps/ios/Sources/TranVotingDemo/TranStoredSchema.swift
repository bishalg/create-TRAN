// Verifies: REQ-DB-011 REQ-DB-012
import Foundation

/// How every record this app keeps on the device is read (spec 030): the `schema` rule here, then
/// the Rust decision `tranStoredRecordDecision`. The same rule as `stored_schema` in
/// `crates/rust-core`, pinned by `fixtures/stored-records.json`.
enum TranStoredSchema {
    /// The version of a record written before records carried `schema` (the first release).
    static let legacy: UInt32 = 1

    /// The version a stored `schema` value names, or `nil` when the record is unreadable.
    ///
    /// `nil` in (no `schema` at all) is the unversioned first release. A present value must be a
    /// whole number from 1 to `UInt32.max`; a string, a boolean, a negative or fractional number,
    /// 0 or a larger number makes the record unreadable. Never traps.
    static func version(_ value: Any?) -> UInt32? {
        guard let value else { return legacy }
        guard let number = value as? NSNumber,
            CFGetTypeID(number) != CFBooleanGetTypeID(),
            !CFNumberIsFloatType(number),
            let version = UInt32(exactly: number.int64Value),
            // `int64Value` wraps a number beyond Int64; the round trip catches it.
            number == NSNumber(value: number.int64Value),
            version > 0
        else { return nil }
        return version
    }

    /// What reading a stored record comes to.
    enum Verdict: Equatable {
        /// Use the record (current, or an older version read into the current shape).
        case use
        /// A version newer than this build: treat as absent and leave it for the app that wrote it.
        case newer
        /// Unreadable: delete it and treat as absent.
        case unreadable
    }

    /// The verdict for a stored `schema` value against the current version of its record.
    static func verdict(_ value: Any?, current: UInt32) -> Verdict {
        guard let version = version(value) else { return .unreadable }
        switch tranStoredRecordDecision(schema: version, current: current) {
        case .use, .upgrade: return .use
        case .discard: return .newer
        }
    }
}
