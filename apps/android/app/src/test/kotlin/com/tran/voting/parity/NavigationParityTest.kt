// Verifies: REQ-NAV-006 REQ-RULE-009
package com.tran.voting.parity

import com.tran.voting.ui.AuthSession
import com.tran.voting.ui.destination
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranAppDestination
import uniffi.tran_uniffi.TranUserRole
import uniffi.tran_uniffi.supportedCountriesOffline
import java.io.File

/** `fixtures/navigation.json` and the country table through the UniFFI surface the app uses. */
class NavigationParityTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private fun fixture(name: String): JSONObject {
            val repoRoot =
                System.getenv("REPO_ROOT")
                    ?: error("REPO_ROOT not set (Gradle test task should provide it)")
            return JSONObject(File(repoRoot, "fixtures/$name").readText())
        }
    }

    private fun session(raw: String): AuthSession =
        when (raw) {
            "none", "unauthenticated" -> AuthSession.Unauthenticated
            "citizen_voter" -> AuthSession.Authenticated("fixture-user", TranUserRole.CITIZEN_VOTER)
            "election_auditor" -> AuthSession.Authenticated("fixture-user", TranUserRole.ELECTION_AUDITOR)
            else -> error("unknown fixture session $raw")
        }

    private fun TranAppDestination.code(): String =
        when (this) {
            TranAppDestination.SPLASH -> "splash"
            TranAppDestination.AUTH_WELCOME -> "auth_welcome"
            TranAppDestination.VOTER_DASHBOARD -> "voter_dashboard"
            TranAppDestination.AUDITOR_DASHBOARD -> "auditor_dashboard"
        }

    @Test
    fun destinationsMatchGoldenFixture() {
        val rows = fixture("navigation.json").getJSONArray("destinations")
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            assertEquals(
                row.getString("name"),
                row.getString("destination"),
                session(row.getString("session")).destination.code(),
            )
        }
    }

    @Test
    fun supportedCountriesMatchGoldenFixture() {
        val rows = fixture("vote-eligibility.json").getJSONArray("countries")
        val expected = (0 until rows.length()).map {
            val row = rows.getJSONObject(it)
            "${row.getString("countryCode")}=${row.getInt("minimumAge")}"
        }
        val actual = supportedCountriesOffline().map { "${it.countryCode}=${it.minimumAge}" }
        assertEquals(expected, actual)
    }
}
