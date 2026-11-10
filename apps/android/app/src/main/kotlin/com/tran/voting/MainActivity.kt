package com.tran.voting

import android.app.Activity
import android.os.Build
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.tran.voting.api.TranApiClient
import com.tran.voting.api.TranRequestFailure
import com.tran.voting.generated.TranBrandTokens
import com.tran.voting.generated.TranTheme
import com.tran.voting.generated.tranColorScheme
import com.tran.voting.ui.AuditorScreen
import com.tran.voting.ui.AuthSession
import com.tran.voting.ui.AuthWelcomeScreen
import com.tran.voting.ui.VotingHomeScreen
import com.tran.voting.ui.atoms.LocalTranPalette
import com.tran.voting.ui.destination
import com.tran.voting.ui.feedback.LocalTranFeedback
import com.tran.voting.ui.feedback.TranFeedback
import com.tran.voting.ui.feedback.TranFeedbackHost
import com.tran.voting.ui.feedback.TranReporting
import com.tran.voting.session.ActivityPrivacyShieldTarget
import com.tran.voting.session.EXTRA_DISABLE_PRIVACY_SHIELD
import com.tran.voting.session.KeystoreSessionVault
import com.tran.voting.session.RestoreOutcome
import com.tran.voting.session.SessionClient
import com.tran.voting.session.applyPrivacyMeasure
import com.tran.voting.session.privacyMeasure
import com.tran.voting.session.restoredSession
import com.tran.voting.session.validateRestoredSession
import kotlinx.coroutines.launch
import uniffi.tran_uniffi.TranAppDestination
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranUserAction
import uniffi.tran_uniffi.TranUserRole

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Uncaught exceptions are reported, then end the app as before (REQ-ERR-011).
        TranReporting.installUncaughtExceptionHandler()
        enableEdgeToEdge()
        // REQ-SEC-021: the stored session decides the first screen at once, with no network.
        val vault = KeystoreSessionVault(this)
        val initialSession = restoredSession(vault)
        val sessions = SessionClient(vault)
        // REQ-SEC-023: a debug screenshot run may switch the shield off; a release build ignores the flag.
        val shieldOffRequested = intent?.getBooleanExtra(EXTRA_DISABLE_PRIVACY_SHIELD, false) == true
        val shield = ActivityPrivacyShieldTarget(this)
        setContent {
            NavigationCoordinator(
                initialSession = initialSession,
                sessions = sessions,
                onSignedInChange = { signedIn ->
                    val sdk = Build.VERSION.SDK_INT
                    applyPrivacyMeasure(shield, privacyMeasure(signedIn, sdk, BuildConfig.DEBUG, shieldOffRequested), sdk)
                },
            )
        }
    }
}

/**
 * Root Navigation Coordinator implementing the central director and role branching.
 *
 * Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005
 */
@Composable
fun NavigationCoordinator(
    // Screenshot tests start in each registry theme and talk to a canned API (ADR-0031).
    initialTheme: TranTheme = TranTheme.DARK,
    api: TranApiClient = TranApiClient(),
    // The stored session to open with. The app passes the vault's; the screen contract's UI tests and
    // the JVM tests start from a preset and pass no [sessions], so they never touch the vault (ADR-0039).
    initialSession: AuthSession = AuthSession.Authenticated(userId = "voter-001", role = TranUserRole.CITIZEN_VOTER),
    // The API session behind the device session (ADR-0039 decision 7); `null` keeps it device-only.
    sessions: SessionClient? = null,
    // Whether a signed-in screen is on display, for the recents privacy shield (REQ-SEC-023).
    onSignedInChange: (Boolean) -> Unit = {},
) {
    var session by remember { mutableStateOf(initialSession) }
    val scope = rememberCoroutineScope()
    // Any theme in the rust-core registry can be selected — no light/dark boolean.
    var theme by remember { mutableStateOf(initialTheme) }
    val palette = TranBrandTokens.palette(theme)
    // One feedback center for the app: toasts and confirmations render above every screen.
    val feedback = remember { TranFeedback() }
    // An expired session asks first; "Sign in again" ends it (REQ-ERR-010).
    LaunchedEffect(feedback) {
        feedback.onErrorConfirmed(TranErrorCode.AUTH_SESSION_EXPIRED) {
            sessions?.endLocally()
            session = AuthSession.Unauthenticated
        }
    }
    // REQ-SEC-021: validate a restored session in the background; only Rust's SIGN_OUT ends it, through
    // the `auth.session_expired` dialog. An unreachable API keeps the user where they are.
    LaunchedEffect(sessions) {
        if (sessions != null && session is AuthSession.Authenticated &&
            validateRestoredSession(sessions) == RestoreOutcome.SIGNED_OUT
        ) {
            feedback.report(TranRequestFailure(TranErrorCode.AUTH_SESSION_EXPIRED, status = 401))
        }
    }
    // Destructive, so the catalogue asks first (REQ-ERR-007). The device forgets the session before
    // the server is asked to revoke it, and whatever the server says (REQ-SEC-022).
    val signOut = {
        feedback.confirm(TranUserAction.SIGN_OUT) {
            val refreshToken = sessions?.endLocally()
            session = AuthSession.Unauthenticated
            if (sessions != null) scope.launch { sessions.revoke(refreshToken) }
        }
    }
    val signedIn = session.destination.let {
        it == TranAppDestination.VOTER_DASHBOARD || it == TranAppDestination.AUDITOR_DASHBOARD
    }
    LaunchedEffect(signedIn) { onSignedInChange(signedIn) }

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
        CompositionLocalProvider(LocalTranPalette provides palette, LocalTranFeedback provides feedback) {
          TranFeedbackHost(feedback) {
            when (session.destination) {
                TranAppDestination.SPLASH, TranAppDestination.AUTH_WELCOME -> {
                    AuthWelcomeScreen { role ->
                        // Signed in on the device at once, offline too; the API session follows behind
                        // and lands in the vault. A failure leaves the device session as it is.
                        session = AuthSession.Authenticated(userId = "user-001", role = role)
                        if (sessions != null) {
                            scope.launch {
                                try {
                                    sessions.signIn(role)
                                } catch (_: TranRequestFailure) {
                                }
                            }
                        }
                    }
                }
                TranAppDestination.VOTER_DASHBOARD -> {
                    VotingHomeScreen(
                        theme = theme,
                        onThemeChange = { theme = it },
                        onSignOut = signOut,
                        api = api,
                    )
                }
                TranAppDestination.AUDITOR_DASHBOARD -> {
                    AuditorScreen(onSignOut = signOut)
                }
            }
          }
        }
    }
}
