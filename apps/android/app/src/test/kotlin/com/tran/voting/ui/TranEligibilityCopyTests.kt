// Verifies: REQ-FFI-003 REQ-ERR-009
package com.tran.voting.ui

import com.tran.voting.generated.TranStrings
import com.tran.voting.parity.VoteEligibilityParityTest
import org.junit.Assert.assertEquals
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranEligibilityReason
import uniffi.tran_uniffi.TranValidationException
import uniffi.tran_uniffi.VoteEligibilityOfflineResult

class TranEligibilityCopyTests {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()
    }

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
    fun errorExtensionUsesTheCatalogueCopyForEachCode() {
        val cases = listOf(
            TranValidationException.AgeOutOfRange() to TranStrings.Errors.ageOutOfRange,
            TranValidationException.BirthdateInFuture() to TranStrings.Errors.birthdateInFuture,
            TranValidationException.InvalidBirthdate() to TranStrings.Errors.dateInvalid,
            TranValidationException.InvalidReferenceDate() to TranStrings.Errors.dateInvalid,
            TranValidationException.InvalidCountryCode() to TranStrings.Errors.countryInvalid,
        )
        for ((error, expected) in cases) {
            assertEquals(error.toString(), expected, error.localizedMessageRes())
        }
    }
}
