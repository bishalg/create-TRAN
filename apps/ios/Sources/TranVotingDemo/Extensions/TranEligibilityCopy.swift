import Foundation

/// App-side behaviour for the generated UniFFI record.
///
/// The generated type stays the single source of truth; this extension only maps its stable
/// reason code to the shared localized copy (REQ-FFI-003).
extension VoteEligibilityOfflineResult {
    /// Localized verdict sentence built from the generated record's facts.
    ///
    /// Uses the boolean verdict and facts, not the core's English prose (REQ-I18N-007).
    var localizedReason: String {
        eligible
            ? L10n.Eligibility.resultReasonMeets(String(age), String(minimumAge), countryCode)
            : L10n.Eligibility.resultReasonBelow(String(age), String(minimumAge), countryCode)
    }
}

/// App-side copy for the generated error variants.
///
/// English `Display` text from Rust never reaches a voter: each variant maps to its catalogue
/// code, and the code to the shared message the server's rejection would show (REQ-ERR-009).
extension TranValidationError {
    /// Localized, user-facing message for a validation failure.
    var localizedMessage: String {
        TranFeedback.message(errorSpec(code: errorCodeForValidation(error: self)).messageKey)
    }
}
