// Verifies: REQ-FFI-003
package com.tran.voting.ui

import com.tran.voting.generated.TranStrings
import org.junit.Assert.assertEquals
import org.junit.Test
import uniffi.tran_uniffi.TranEligibilityReason
import uniffi.tran_uniffi.TranValidationException
import uniffi.tran_uniffi.VoteEligibilityOfflineResult

class TranEligibilityCopyTests {
    @Test
    fun recordExtensionUsesTheSharedReasonKeys() {
        val eligible =
            VoteEligibilityOfflineResult(
                true,
                20.toUShort(),
                18.toUShort(),
                "NP",
                TranEligibilityReason.MEETS_MINIMUM_AGE,
            )
        assertEquals(TranStrings.Eligibility.resultReasonMeets, eligible.reasonRes())

        val underage =
            VoteEligibilityOfflineResult(
                false,
                17.toUShort(),
                18.toUShort(),
                "US",
                TranEligibilityReason.BELOW_MINIMUM_AGE,
            )
        assertEquals(TranStrings.Eligibility.resultReasonBelow, underage.reasonRes())
    }

    @Test
    fun errorExtensionMapsEveryVariantToSharedCopy() {
        assertEquals(
            TranStrings.Errors.ageOutOfRange,
            TranValidationException.AgeOutOfRange().localizedMessageRes(),
        )
        assertEquals(
            TranStrings.Errors.ageInvalid,
            TranValidationException.BirthdateInFuture().localizedMessageRes(),
        )
        assertEquals(
            TranStrings.Errors.ageInvalid,
            TranValidationException.InvalidBirthdate().localizedMessageRes(),
        )
        assertEquals(
            TranStrings.Errors.ageInvalid,
            TranValidationException.InvalidReferenceDate().localizedMessageRes(),
        )
        assertEquals(
            TranStrings.Errors.countryInvalid,
            TranValidationException.InvalidCountryCode().localizedMessageRes(),
        )
        assertEquals(
            TranStrings.Errors.ageAndCountry,
            TranValidationException.Internal().localizedMessageRes(),
        )
    }
}
