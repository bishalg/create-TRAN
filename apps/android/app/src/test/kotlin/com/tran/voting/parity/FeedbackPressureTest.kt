// Verifies: REQ-ERR-010 REQ-ERR-012 REQ-ERR-013 REQ-ERR-014
package com.tran.voting.parity

import com.tran.voting.api.TranRequestFailure
import com.tran.voting.generated.TranStrings
import com.tran.voting.ui.feedback.TranFeedback
import com.tran.voting.ui.feedback.TranReporting
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranPresentation
import uniffi.tran_uniffi.TranToastAdmission
import uniffi.tran_uniffi.TranToastKey
import uniffi.tran_uniffi.TranToastTone
import uniffi.tran_uniffi.TranUserAction
import uniffi.tran_uniffi.admitToast
import uniffi.tran_uniffi.errorCatalogue
import uniffi.tran_uniffi.isReportedLogLevel
import uniffi.tran_uniffi.recoveryPolicy
import uniffi.tran_uniffi.recoveryProbeDelayMs
import uniffi.tran_uniffi.toastPolicy

/** Toast pressure, failure dialogs, the recovery schedule and the reporter (ADR-0036). */
class FeedbackPressureTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private fun fixture(): JSONObject {
            val repoRoot = File(System.getenv("REPO_ROOT") ?: "../../..")
            return JSONObject(File(repoRoot, "fixtures/feedback.json").readText())
        }
    }

    private fun key(pair: JSONArray) =
        TranToastKey(messageKey = pair.getString(0), tone = TranToastTone.valueOf(pair.getString(1).uppercase()))

    private fun quietFeedback() = TranFeedback(log = { _, _ -> })

    @After
    fun clearSink() {
        TranReporting.sink = null
    }

    @Test
    fun toastAdmissionMatchesEveryFixtureCase() {
        val fixture = fixture()
        assertEquals(fixture.getJSONObject("toastPolicy").getInt("maxVisible"), toastPolicy().maxVisible.toInt())
        val rows = fixture.getJSONArray("toastQueue")
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            val visible = row.getJSONArray("visible").let { list -> (0 until list.length()).map { key(list.getJSONArray(it)) } }
            val expected = row.getJSONObject("expected")
            val want = if (expected.isNull("refresh")) {
                TranToastAdmission.Append(expected.getInt("evictOldest").toUInt())
            } else {
                TranToastAdmission.Refresh(expected.getInt("refresh").toUInt())
            }
            assertEquals(row.getString("name"), want, admitToast(visible, key(row.getJSONArray("incoming"))))
        }
    }

    @Test
    fun recoveryScheduleAndReportedLevelsMatchTheFixture() {
        val fixture = fixture()
        val policy = fixture.getJSONObject("recoveryPolicy")
        assertEquals(policy.getLong("firstProbeMs"), recoveryPolicy().firstProbeMs.toLong())
        assertEquals(policy.getLong("maxProbeMs"), recoveryPolicy().maxProbeMs.toLong())
        val probes = fixture.getJSONArray("recoveryProbes")
        for (i in 0 until probes.length()) {
            val row = probes.getJSONObject(i)
            assertEquals(row.getLong("expectedMs"), recoveryProbeDelayMs(row.getInt("probe").toUInt()).toLong())
        }
        val levels = fixture.getJSONArray("reportedLogLevels").let { list -> (0 until list.length()).map(list::getString) }
        assertEquals(levels, TranLogLevel.entries.filter(::isReportedLogLevel).map { it.name.lowercase() })
    }

    @Test
    fun aRepeatedFailureRefreshesOneToast() {
        val feedback = quietFeedback()
        feedback.report(TranRequestFailure(TranErrorCode.SERVER_INTERNAL, requestId = "req-1"))
        feedback.report(TranRequestFailure(TranErrorCode.SERVER_INTERNAL, requestId = "req-2"))
        assertEquals(1, feedback.toasts.size)
        assertEquals(1, feedback.toasts[0].generation)
        assertEquals("req-2", feedback.toasts[0].requestId)
    }

    @Test
    fun atMostThreeToastsAndTheOldestGoesFirst() {
        val feedback = quietFeedback()
        feedback.report(TranRequestFailure(TranErrorCode.SERVER_INTERNAL))
        feedback.report(TranRequestFailure(TranErrorCode.SERVER_RATE_LIMITED))
        feedback.report(TranRequestFailure(TranErrorCode.AUTH_FORBIDDEN))
        feedback.acknowledge(TranUserAction.SERVER_CHECK_SUCCEEDED)
        assertEquals(3, feedback.toasts.size)
        assertEquals(TranStrings.Eligibility.serverCheckDone, feedback.toast?.messageRes)
        assertEquals(TranStrings.Errors.rateLimited, feedback.toasts[0].messageRes)
        feedback.dismissToast(feedback.toasts[0].id)
        assertEquals(2, feedback.toasts.size)
    }

    @Test
    fun anExpiredSessionAsksAndOnlyConfirmSignsOut() {
        val feedback = quietFeedback()
        var signedOut = 0
        feedback.onErrorConfirmed(TranErrorCode.AUTH_SESSION_EXPIRED) { signedOut += 1 }
        val presentation = feedback.report(TranRequestFailure(TranErrorCode.AUTH_SESSION_EXPIRED, status = 401))
        assertEquals(TranPresentation.Dialog(destructive = false), presentation)
        val pending = feedback.confirmation!!
        assertEquals(TranStrings.Errors.sessionExpired, pending.titleRes)
        assertEquals(TranStrings.Errors.sessionExpiredBody, pending.bodyRes)
        assertEquals(TranStrings.Auth.signInAgain, pending.confirmRes)
        assertEquals(TranStrings.Common.notNow, pending.cancelRes)
        assertEquals(0, signedOut)
        pending.onConfirm()
        assertEquals(1, signedOut)
        assertNull(feedback.confirmation)
        assertNull(feedback.toast)
    }

    @Test
    fun everyDialogFailureHasCopy() {
        for (spec in errorCatalogue()) {
            if (spec.presentation is TranPresentation.Dialog) {
                assertNotNull(spec.wireCode, TranFeedback.errorDialogCopy(spec.code))
            }
        }
    }

    @Test
    fun onlyErrorLevelFailuresReachTheReporterAndOnlyClientCodesCarryTheCause() {
        val events = mutableListOf<Pair<TranReporting.Event, Throwable?>>()
        TranReporting.sink = { event, cause -> events += event to cause }
        val feedback = quietFeedback()
        val bug = IllegalStateException("bug")
        feedback.log(TranRequestFailure(TranErrorCode.NETWORK_OFFLINE))
        feedback.log(TranRequestFailure(TranErrorCode.AUTH_FORBIDDEN, status = 403))
        feedback.log(TranRequestFailure(TranErrorCode.SERVER_INTERNAL, status = 500, requestId = "req-9", cause = bug))
        feedback.log(TranRequestFailure(TranErrorCode.CLIENT_UNEXPECTED, cause = bug))
        assertEquals(
            listOf(
                TranReporting.Event("server.internal", 500, "req-9"),
                TranReporting.Event("client.unexpected", null, null),
            ),
            events.map { it.first },
        )
        assertNull(events[0].second)
        assertSame(bug, events[1].second)
    }

    @Test
    fun aReporterThatThrowsDoesNotBreakLogging() {
        TranReporting.sink = { _, _ -> error("sink down") }
        quietFeedback().log(TranRequestFailure(TranErrorCode.SERVER_INTERNAL))
    }
}
