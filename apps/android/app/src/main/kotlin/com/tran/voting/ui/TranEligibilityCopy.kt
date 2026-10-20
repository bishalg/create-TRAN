package com.tran.voting.ui

import android.content.Context
import com.tran.voting.generated.TranStrings
import uniffi.tran_uniffi.TranValidationException
import uniffi.tran_uniffi.VoteEligibilityOfflineResult

/**
 * App-side behaviour for the generated UniFFI record.
 *
 * The generated type stays the single source of truth; these extensions only map its stable
 * reason code to the shared localized copy (REQ-FFI-003).
 */
fun VoteEligibilityOfflineResult.reasonRes(): Int =
    if (eligible) TranStrings.Eligibility.resultReasonMeets else TranStrings.Eligibility.resultReasonBelow

/** Localized verdict sentence built from the generated record's facts. */
fun VoteEligibilityOfflineResult.localizedReason(context: Context): String =
    context.getString(
        reasonRes(),
        age.toString(),
        minimumAge.toString(),
        countryCode,
    )

/** Localized, user-facing message for a generated validation failure. */
fun TranValidationException.localizedMessageRes(): Int =
    when (this) {
        is TranValidationException.AgeOutOfRange -> TranStrings.Errors.ageOutOfRange
        is TranValidationException.BirthdateInFuture,
        is TranValidationException.InvalidBirthdate,
        is TranValidationException.InvalidReferenceDate,
        -> TranStrings.Errors.ageInvalid
        is TranValidationException.InvalidCountryCode -> TranStrings.Errors.countryInvalid
        is TranValidationException.Internal -> TranStrings.Errors.ageAndCountry
    }
