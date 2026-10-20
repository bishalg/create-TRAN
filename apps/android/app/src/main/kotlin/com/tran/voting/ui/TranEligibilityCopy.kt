package com.tran.voting.ui

import android.content.Context
import com.tran.voting.generated.TranStrings
import uniffi.tran_uniffi.TranValidationException
import com.tran.voting.ui.feedback.TranFeedback
import uniffi.tran_uniffi.VoteEligibilityOfflineResult
import uniffi.tran_uniffi.errorCodeForValidation
import uniffi.tran_uniffi.errorSpec

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

/**
 * Localized, user-facing message for a generated validation failure: the variant's catalogue code,
 * then the code's shared message — the same copy a server rejection shows (REQ-ERR-009).
 */
fun TranValidationException.localizedMessageRes(): Int =
    TranFeedback.messageRes(errorSpec(errorCodeForValidation(this)).messageKey)
