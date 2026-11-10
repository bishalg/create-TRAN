// Verifies: REQ-PRV-001 REQ-PRV-002 REQ-PRV-008
package com.tran.voting.parity

import com.tran.voting.generated.ScreenContract
import com.tran.voting.permissions.PermissionCopy
import com.tran.voting.permissions.code
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranPermissionStatus
import uniffi.tran_uniffi.permissionCatalogue
import uniffi.tran_uniffi.permissionEntry
import uniffi.tran_uniffi.permissionStep
import uniffi.tran_uniffi.personalQuestions
import java.io.File
import java.util.Locale

/** `fixtures/permissions.json` through the UniFFI surface the app uses (spec 026). */
class PermissionParityTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private val fixture: JSONObject by lazy {
            val repoRoot = System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set (Gradle test task should provide it)")
            JSONObject(File(repoRoot, "fixtures/permissions.json").readText())
        }

        private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)

        private fun JSONArray.strings(): List<String> = (0 until length()).map(::getString)

        private fun Enum<*>.snake(): String = name.lowercase(Locale.ROOT)
    }

    @Test
    fun `REQ-PRV-001 the catalogue matches the fixture`() {
        val expected = fixture.getJSONArray("permissions").objects()
        val actual = permissionCatalogue()
        assertEquals(expected.map { it.getString("id") }, actual.map { it.id.code })
        for ((row, entry) in expected.zip(actual)) {
            val id = row.getString("id")
            assertEquals(id, entry, permissionEntry(entry.id))
            assertEquals("$id feature", row.getString("feature"), entry.feature)
            assertEquals("$id control", row.getString("control"), entry.control)
            assertEquals("$id priming title", row.getString("primingTitle"), entry.primingTitleKey)
            assertEquals("$id priming body", row.getString("primingBody"), entry.primingBodyKey)
            assertEquals("$id purpose", row.getString("purpose"), entry.purposeKey)
            assertEquals("$id settings note", row.getString("settingsNote"), entry.settingsNoteKey)
            assertEquals("$id fallback", row.getString("fallback"), entry.fallback.snake())
            assertEquals("$id android", row.getJSONArray("androidPermissions").strings(), entry.androidPermissions)
            assertEquals("$id ios", row.getJSONArray("iosUsageDescriptions").strings(), entry.iosUsageDescriptions)
        }
    }

    @Test
    fun `REQ-PRV-001 the app has a string for every key the catalogue names and declares its control`() {
        val location = permissionCatalogue().single { it.control == ScreenContract.Eligibility.useLocationButton }
        for (entry in permissionCatalogue()) {
            for (key in listOf(entry.primingTitleKey, entry.primingBodyKey, entry.purposeKey, entry.settingsNoteKey)) {
                assertNotNull("${entry.id.code}: no string resource for $key", PermissionCopy.res(key))
            }
        }
        assertEquals(listOf("android.permission.ACCESS_COARSE_LOCATION"), location.androidPermissions)
    }

    @Test
    fun `REQ-PRV-002 every step matches the fixture`() {
        val rows = fixture.getJSONArray("steps").objects()
        assertEquals("every (status, primed) pair", TranPermissionStatus.entries.size * 2, rows.size)
        for (row in rows) {
            val status = TranPermissionStatus.entries.single { it.snake() == row.getString("status") }
            assertEquals(row.getString("name"), row.getString("step"), permissionStep(status, row.getBoolean("primed")).snake())
        }
    }

    @Test
    fun `REQ-PRV-008 the personal questions match the fixture`() {
        val expected = fixture.getJSONArray("personalQuestions").objects()
        val actual = personalQuestions()
        assertEquals(expected.map { it.getString("id") }, actual.map { it.id })
        for ((row, question) in expected.zip(actual)) {
            assertEquals(row.getString("feature"), question.feature)
            assertEquals(row.getString("label"), question.labelKey)
            assertEquals(if (row.isNull("required")) null else row.getString("required"), question.requiredBy)
            val answers = row.getJSONArray("answers").objects()
            assertEquals(
                answers.map { listOf(it.getString("id"), it.getString("kind"), it.getString("label")) },
                question.answers.map { listOf(it.id, it.kind.snake(), it.labelKey) },
            )
        }
    }
}
