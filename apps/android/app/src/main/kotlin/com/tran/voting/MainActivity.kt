package com.tran.voting

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.tran.voting.ui.AppDestination
import com.tran.voting.ui.AuditorScreen
import com.tran.voting.ui.AuthSession
import com.tran.voting.ui.AuthWelcomeScreen
import com.tran.voting.ui.NavigationDirector
import com.tran.voting.ui.UserRole
import com.tran.voting.ui.VotingHomeScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            NavigationCoordinator()
        }
    }
}

/**
 * Root Navigation Coordinator implementing the central director and role branching.
 *
 * Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005
 */
@Composable
fun NavigationCoordinator() {
    var session by remember {
        mutableStateOf<AuthSession>(
            AuthSession.Authenticated(userId = "voter-001", role = UserRole.CITIZEN_VOTER)
        )
    }

    when (NavigationDirector.resolveDestination(session)) {
        AppDestination.SPLASH, AppDestination.AUTH_WELCOME -> {
            AuthWelcomeScreen { role ->
                session = AuthSession.Authenticated(userId = "user-001", role = role)
            }
        }
        AppDestination.VOTER_DASHBOARD -> {
            VotingHomeScreen(onSignOut = {
                session = AuthSession.Unauthenticated
            })
        }
        AppDestination.AUDITOR_DASHBOARD -> {
            AuditorScreen(onSignOut = {
                session = AuthSession.Unauthenticated
            })
        }
    }
}
