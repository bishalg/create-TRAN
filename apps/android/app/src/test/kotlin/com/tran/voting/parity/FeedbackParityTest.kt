// Verifies: REQ-ERR-001 REQ-ERR-006 REQ-ERR-007 REQ-ERR-008 REQ-ERR-009
package com.tran.voting.parity

import com.tran.voting.api.TranRequestFailure
import com.tran.voting.generated.TranStrings
import com.tran.voting.generated.feedbackMessageRes
import com.tran.voting.ui.feedback.TranFeedback
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranPresentation
import uniffi.tran_uniffi.TranToastDuration
import uniffi.tran_uniffi.TranToastTone
import uniffi.tran_uniffi.TranUserAction
import uniffi.tran_uniffi.TranVerdictSource
import uniffi.tran_uniffi.actionSpec
import uniffi.tran_uniffi.errorCatalogue
import uniffi.tran_uniffi.loadingPolicy
import uniffi.tran_uniffi.toastDurationMs
import uniffi.tran_uniffi.verdictSourceSpec

/** `fixtures/feedback.json` through the UniFFI surface, plus the Android feedback center that applies it. */
class FeedbackParityTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private fun fixture(): JSONObject {
            val repoRoot = File(System.getenv("REPO_ROOT") ?: "../../..")
            return JSONObject(File(repoRoot, "fixtures/feedback.json").readText())
        }
    }

    private fun TranPresentation.json(): Map<String, Any> = when (this) {
        TranPresentation.Silent -> mapOf("kind" to "silent")
        TranPresentation.Inline -> mapOf("kind" to "inline")
        TranPresentation.Banner -> mapOf("kind" to "banner")
        is TranPresentation.Dialog -> mapOf("kind" to "dialog", "destructive" to destructive)
        is TranPresentation.Toast -> mapOf(
            "kind" to "toast",
            "tone" to tone.name.lowercase(),
            "duration" to duration.name.lowercase(),
        )
    }

    private fun JSONObject.asMap(): Map<String, Any> = keys().asSequence().associateWith { get(it) }

    private fun quietFeedback() = TranFeedback(log = { _, _ -> })

    @Test
    fun catalogueMatchesTheGoldenFixtureAndEveryMessageHasAResource() {
        val rows = fixture().getJSONArray("errors")
        val catalogue = errorCatalogue()
        assertEquals(rows.length(), catalogue.size)
        catalogue.forEachIndexed { index, spec ->
            val row = rows.getJSONObject(index)
            val code = row.getString("code")
            assertEquals(code, spec.wireCode)
            assertEquals(code, row.opt("httpStatus").takeIf { it is Int }, spec.httpStatus?.toInt())
            assertEquals(code, row.getBoolean("retryable"), spec.retryable)
            assertEquals(code, row.getString("logLevel"), spec.logLevel.name.lowercase())
            assertEquals(code, row.getJSONObject("presentation").asMap(), spec.presentation.json())
            assertEquals(code, row.getString("messageKey"), spec.messageKey)
            assertNotNull("${spec.messageKey} has no Android string", feedbackMessageRes[spec.messageKey])
        }
    }

    @Test
    fun toastDurationsMatchTheFixture() {
        val durations = fixture().getJSONObject("toastDurationsMs")
        for (duration in TranToastDuration.entries) {
            assertEquals(durations.getLong(duration.name.lowercase()), toastDurationMs(duration).toLong())
        }
    }

    // Verifies: REQ-LOAD-001
    @Test
    fun loadingPolicyMatchesTheFixtureAndItsCopyHasAResource() {
        val row = fixture().getJSONObject("loadingPolicy")
        val policy = loadingPolicy()
        assertEquals(row.getLong("indicatorDelayMs"), policy.indicatorDelayMs.toLong())
        assertEquals(row.getString("pendingMessageKey"), policy.pendingMessageKey)
        assertNotNull("${policy.pendingMessageKey} has no Android string", feedbackMessageRes[policy.pendingMessageKey])
    }

    // Verifies: REQ-LOAD-001
    @Test
    fun verdictSourcesMatchTheFixtureAndEveryLabelHasAResource() {
        val rows = fixture().getJSONArray("verdictSources")
        assertEquals(rows.length(), TranVerdictSource.entries.size)
        TranVerdictSource.entries.forEachIndexed { index, source ->
            val row = rows.getJSONObject(index)
            val spec = verdictSourceSpec(source)
            assertEquals(source, spec.source)
            assertEquals(row.getString("source"), spec.wireName)
            assertEquals(spec.wireName, row.getString("messageKey"), spec.messageKey)
            assertNotNull("${spec.messageKey} has no Android string", feedbackMessageRes[spec.messageKey])
        }
    }

    @Test
    fun successIsAShortSuccessToast() {
        val feedback = quietFeedback()
        feedback.acknowledge(TranUserAction.SERVER_CHECK_SUCCEEDED)
        val toast = feedback.toast!!
        assertEquals(TranToastTone.SUCCESS, toast.tone)
        assertEquals(TranStrings.Eligibility.serverCheckDone, toast.messageRes)
        assertEquals(3000L, toast.durationMs)
        assertNull(toast.requestId)
        feedback.dismissToast()
        assertNull(feedback.toast)
    }

    @Test
    fun serverFailureIsALongLoggedToastWithAReference() {
        val logged = mutableListOf<String>()
        val feedback = TranFeedback(log = { level, message -> logged += "$level $message" })
        val presentation = feedback.report(TranRequestFailure(TranErrorCode.SERVER_INTERNAL, requestId = "req-9"))
        assertEquals(TranPresentation.Toast(TranToastTone.ERROR, TranToastDuration.LONG), presentation)
        assertEquals(10_000L, feedback.toast?.durationMs)
        assertEquals("req-9", feedback.toast?.requestId)
        assertTrue(logged.single(), logged.single().startsWith("ERROR request failed code=server.internal"))
    }

    // Verifies: REQ-ROB-007
    @Test
    fun logLineCarriesTheFixedFieldsOfTheLogEvent() {
        val event = fixture().getJSONObject("logEvent")
        val full = TranFeedback.logLine(TranRequestFailure(TranErrorCode.SERVER_INTERNAL, status = 500, requestId = "req-9"))
        assertEquals("request failed code=server.internal status=500 request_id=req-9", full)
        assertTrue(full.startsWith(event.getString("message")))
        val fields = event.getJSONArray("fields")
        for (i in 0 until fields.length()) assertTrue(fields.getString(i), full.contains(" ${fields.getString(i)}="))
        assertEquals(
            "request failed code=network.offline status=- request_id=-",
            TranFeedback.logLine(TranRequestFailure(TranErrorCode.NETWORK_OFFLINE)),
        )
    }

    @Test
    fun screenOwnedPresentationsDoNotToast() {
        val feedback = quietFeedback()
        assertEquals(TranPresentation.Banner, feedback.report(TranRequestFailure(TranErrorCode.NETWORK_OFFLINE)))
        assertEquals(TranPresentation.Inline, feedback.report(TranRequestFailure(TranErrorCode.VALIDATION_INVALID_DATE)))
        assertNull(feedback.toast)
    }

    @Test
    fun signOutAsksFirstAndOnlyConfirmPerforms() {
        val feedback = quietFeedback()
        var signedOut = false
        feedback.confirm(TranUserAction.SIGN_OUT) { signedOut = true }
        val pending = feedback.confirmation!!
        assertEquals(TranStrings.Auth.signOutConfirmTitle, pending.titleRes)
        assertEquals(TranStrings.Auth.signOutConfirmBody, pending.bodyRes)
        assertEquals(TranStrings.Common.signOut, pending.confirmRes)
        assertTrue(pending.destructive)
        assertFalse("nothing happens until the user confirms", signedOut)

        feedback.cancelConfirmation()
        assertNull(feedback.confirmation)
        assertFalse(signedOut)

        feedback.confirm(TranUserAction.SIGN_OUT) { signedOut = true }
        feedback.confirmation!!.onConfirm()
        assertTrue(signedOut)
        assertNull(feedback.confirmation)
    }

    @Test
    fun actionsWithoutADialogRunImmediately() {
        val feedback = quietFeedback()
        var ran = false
        feedback.confirm(TranUserAction.SERVER_CHECK_SUCCEEDED) { ran = true }
        assertTrue(ran)
        assertNull(feedback.confirmation)
    }

    @Test
    fun everyDialogActionHasCopy() {
        for (action in TranUserAction.entries) {
            if (actionSpec(action).presentation is TranPresentation.Dialog) {
                assertNotNull("$action needs dialog copy", TranFeedback.dialogCopy(action))
            }
        }
    }
}
