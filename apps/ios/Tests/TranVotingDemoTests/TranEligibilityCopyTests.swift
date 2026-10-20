// Verifies: REQ-FFI-003 REQ-ERR-009
import XCTest

final class TranEligibilityCopyTests: XCTestCase {
    func testRecordExtensionBuildsLocalizedReasons() {
        let eligible = VoteEligibilityOfflineResult(
            eligible: true,
            age: 20,
            minimumAge: 18,
            countryCode: "NP",
            reason: .meetsMinimumAge
        )
        XCTAssertEqual(
            eligible.localizedReason,
            L10n.Eligibility.resultReasonMeets("20", "18", "NP")
        )

        let underage = VoteEligibilityOfflineResult(
            eligible: false,
            age: 17,
            minimumAge: 18,
            countryCode: "US",
            reason: .belowMinimumAge
        )
        XCTAssertEqual(
            underage.localizedReason,
            L10n.Eligibility.resultReasonBelow("17", "18", "US")
        )
    }

    func testErrorExtensionUsesTheCatalogueCopyForEachCode() {
        XCTAssertEqual(TranValidationError.AgeOutOfRange.localizedMessage, L10n.Errors.ageOutOfRange)
        XCTAssertEqual(
            TranValidationError.BirthdateInFuture.localizedMessage, L10n.Errors.birthdateInFuture)
        XCTAssertEqual(TranValidationError.InvalidBirthdate.localizedMessage, L10n.Errors.dateInvalid)
        XCTAssertEqual(
            TranValidationError.InvalidReferenceDate.localizedMessage, L10n.Errors.dateInvalid)
        XCTAssertEqual(
            TranValidationError.InvalidCountryCode.localizedMessage,
            L10n.Errors.countryInvalid
        )
    }
}
