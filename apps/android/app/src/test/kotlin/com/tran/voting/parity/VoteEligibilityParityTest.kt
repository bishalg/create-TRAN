package com.tran.voting.parity

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranValidationException
import uniffi.tran_uniffi.evaluateVoteEligibilityOffline
import java.io.File

class VoteEligibilityParityTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() {
            val libDir =
                System.getenv("UNIFFI_LIB_DIR")
                    ?: File(System.getProperty("user.dir"))
                        .parentFile
                        .parentFile
                        .parentFile
                        .resolve("target/release")
                        .absolutePath
            System.setProperty("jna.library.path", libDir)
        }

        private fun fixtureJson(): JSONObject {
            val repoRoot =
                System.getenv("REPO_ROOT")
                    ?: error("REPO_ROOT not set (Gradle test task should provide it)")
            val file = File(repoRoot, "fixtures/vote-eligibility.json")
            return JSONObject(file.readText())
        }
    }

    @Test
    fun evaluationsMatchGoldenFixture() {
        val evaluations = fixtureJson().getJSONArray("evaluations")
        for (i in 0 until evaluations.length()) {
            val row = evaluations.getJSONObject(i)
            val input = row.getJSONObject("input")
            val age = input.getInt("age").toUShort()
            val birth = if (input.has("birthdate")) input.getString("birthdate") else null
            val country = row.getString("countryCode")
            val reference = row.getString("referenceDate")
            val expected = row.getJSONObject("expected")

            val result =
                evaluateVoteEligibilityOffline(age, birth, country, reference)

            assertEquals(row.getString("name"), expected.getBoolean("eligible"), result.eligible)
            assertEquals(row.getString("name"), expected.getInt("age"), result.age.toInt())
            assertEquals(row.getString("name"), expected.getInt("minimumAge"), result.minimumAge.toInt())
            assertEquals(row.getString("name"), expected.getString("countryCode"), result.countryCode)
            assertEquals(row.getString("name"), expected.getString("reason"), result.reason)
        }
    }

    @Test
    fun rejectedEvaluationsMatchGoldenFixture() {
        val rejected = fixtureJson().getJSONArray("rejectedEvaluations")
        for (i in 0 until rejected.length()) {
            val row = rejected.getJSONObject(i)
            val input = row.getJSONObject("input")
            val age = input.getInt("age").toUShort()
            val birth = if (input.has("birthdate")) input.getString("birthdate") else null
            val country = row.getString("countryCode")
            val reference = row.getString("referenceDate")
            val expectedError = row.getString("error")

            try {
                evaluateVoteEligibilityOffline(age, birth, country, reference)
                fail("Expected validation error for ${row.getString("name")}")
            } catch (e: TranValidationException.ValidationException) {
                assertEquals(expectedError, e.detail)
            }
        }
    }
}
