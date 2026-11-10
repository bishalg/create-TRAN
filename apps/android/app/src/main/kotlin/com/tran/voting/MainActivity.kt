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
import com.tran.voting.permissions.CountryGeocoder
import com.tran.voting.permissions.EXTRA_PERMISSION
import com.tran.voting.permissions.NoCountryGeocoder
import com.tran.voting.permissions.PermissionGateway
import com.tran.voting.permissions.StagedPermissionGateway
import com.tran.voting.permissions.SystemCountryGeocoder
import com.tran.voting.permissions.SystemPermissionGateway
import com.tran.voting.permissions.permissionGatewayFor
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
import uniffi.tran_uniffi.TranPresentation
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
        // Spec 026: a debug build may stage a permission's status (`--es tran.permission
        // location_approximate=denied_permanently`); a release build always asks the system. The
        // system gateway registers its result launcher here, before the activity starts.
        val permissions = permissionGatewayFor(BuildConfig.DEBUG, intent?.getStringExtra(EXTRA_PERMISSION)) {
            SystemPermissionGateway(this)
        }
        val geocoder = SystemCountryGeocoder(this)
        setContent {
            NavigationCoordinator(
                initialSession = initialSession,
                sessions = sessions,
                permissions = permissions,
                geocoder = geocoder,
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
 * Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005 REQ-ACC-004 REQ-ACC-006
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
    // "Use my location" (spec 026). Tests and the screen contract's interpreter stage it; only the
    // activity passes the system's, so no test can raise a system dialog.
    permissions: PermissionGateway = remember { StagedPermissionGateway() },
    geocoder: CountryGeocoder = NoCountryGeocoder,
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
            validateRestoredSession(sessions, feedback::log) == RestoreOutcome.SIGNED_OUT
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
    // Deleting is the opposite of signing out (ADR-0041 decision 4): it asks first, and the device
    // follows only the server's `204`. A failure changes nothing and is presented like any other;
    // a banner failure is the screen's to show. Without an API session (the screen contract's
    // preset) the request still goes out, with no credential, so only the server can end it.
    val accountClient = sessions ?: remember(api) { SessionClient.deviceOnly(api) }
    var accountFailure by remember { mutableStateOf<TranRequestFailure?>(null) }
    // One deletion at a time: the control is disabled until the answer arrives (REQ-ACC-006).
    var deleting by remember { mutableStateOf(false) }
    LaunchedEffect(session) { accountFailure = null }
    val deleteAccount = {
        if (!deleting) {
            feedback.confirm(TranUserAction.DELETE_ACCOUNT) {
                deleting = true
                scope.launch {
                    try {
                        accountClient.deleteAccount()
                        session = AuthSession.Unauthenticated
                        feedback.acknowledge(TranUserAction.ACCOUNT_DELETED)
                    } catch (failure: TranRequestFailure) {
                        // The failure's one log event (REQ-ROB-007) and its presentation.
                        if (feedback.report(failure) is TranPresentation.Banner) accountFailure = failure
                    } finally {
                        deleting = false
                    }
                }
            }
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
                                } catch (failure: TranRequestFailure) {
                                    // Not the user's call to hear about: log it, never toast.
                                    feedback.log(failure)
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
                        onDeleteAccount = deleteAccount,
                        deleting = deleting,
                        accountFailure = accountFailure,
                        permissions = permissions,
                        geocoder = geocoder,
                    )
                }
                TranAppDestination.AUDITOR_DASHBOARD -> {
                    AuditorScreen(
                        onSignOut = signOut,
                        onDeleteAccount = deleteAccount,
                        deleting = deleting,
                        accountFailure = accountFailure,
                    )
                }
            }
          }
        }
    }
}
