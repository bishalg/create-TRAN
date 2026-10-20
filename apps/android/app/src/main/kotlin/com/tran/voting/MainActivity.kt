package com.tran.voting

import android.app.Activity
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.tran.voting.generated.TranBrandTokens
import com.tran.voting.generated.TranTheme
import com.tran.voting.generated.tranColorScheme
import com.tran.voting.ui.AuditorScreen
import com.tran.voting.ui.AuthSession
import com.tran.voting.ui.AuthWelcomeScreen
import com.tran.voting.ui.VotingHomeScreen
import com.tran.voting.ui.atoms.LocalTranPalette
import com.tran.voting.ui.destination
import uniffi.tran_uniffi.TranAppDestination
import uniffi.tran_uniffi.TranUserRole

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
            AuthSession.Authenticated(userId = "voter-001", role = TranUserRole.CITIZEN_VOTER)
        )
    }
    // Any theme in the rust-core registry can be selected — no light/dark boolean.
    var theme by remember { mutableStateOf(TranTheme.DARK) }
    val palette = TranBrandTokens.palette(theme)

    val view = LocalView.current
    LaunchedEffect(palette) {
        val window = (view.context as Activity).window
        WindowCompat.getInsetsController(window, view).apply {
            // Appearance follows the palette's own metadata, not the theme name.
            isAppearanceLightStatusBars = palette.isLight
            isAppearanceLightNavigationBars = palette.isLight
        }
    }

    MaterialTheme(colorScheme = tranColorScheme(palette)) {
        // Atoms read the registry palette from the composition (web's CSS-variable analogue).
        CompositionLocalProvider(LocalTranPalette provides palette) {
            when (session.destination) {
                TranAppDestination.SPLASH, TranAppDestination.AUTH_WELCOME -> {
                    AuthWelcomeScreen { role ->
                        session = AuthSession.Authenticated(userId = "user-001", role = role)
                    }
                }
                TranAppDestination.VOTER_DASHBOARD -> {
                    VotingHomeScreen(
                        theme = theme,
                        onThemeChange = { theme = it },
                        onSignOut = {
                            session = AuthSession.Unauthenticated
                        }
                    )
                }
                TranAppDestination.AUDITOR_DASHBOARD -> {
                    AuditorScreen(onSignOut = {
                        session = AuthSession.Unauthenticated
                    })
                }
            }
        }
    }
}
