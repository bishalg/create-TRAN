package com.tran.voting

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
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
import com.tran.voting.push.InMemoryPushStore
import com.tran.voting.push.NotificationOpens
import com.tran.voting.push.NotificationReminder
import com.tran.voting.push.PushEvents
import com.tran.voting.push.PushGateway
import com.tran.voting.push.PushPreferences
import com.tran.voting.push.PushRegistration
import com.tran.voting.push.PushStore
import com.tran.voting.push.PushTrigger
import com.tran.voting.push.StagedPushGateway
import com.tran.voting.push.SystemPushGateway
import com.tran.voting.push.isNotificationOpen
import com.tran.voting.push.pushGatewayFor
import com.tran.voting.ui.AuditorScreen
import com.tran.voting.ui.AuthSession
import com.tran.voting.ui.AuthWelcomeScreen
import com.tran.voting.ui.UpdateRequiredScreen
import com.tran.voting.ui.VotingHomeScreen
import com.tran.voting.ui.atoms.LocalTranPalette
import com.tran.voting.ui.destination
import com.tran.voting.ui.feedback.LocalTranFeedback
import com.tran.voting.ui.feedback.TranFeedback
import com.tran.voting.ui.feedback.TranFeedbackHost
import com.tran.voting.ui.feedback.TranReporting
import com.tran.voting.ui.feedback.tranLogcat
import com.tran.voting.session.ActivityPrivacyShieldTarget
import com.tran.voting.session.EXTRA_DISABLE_PRIVACY_SHIELD
import com.tran.voting.session.KeystoreSessionVault
import com.tran.voting.session.RestoreOutcome
import com.tran.voting.session.SessionClient
import com.tran.voting.session.applyPrivacyMeasure
import com.tran.voting.session.privacyMeasure
import com.tran.voting.session.restoredSession
import com.tran.voting.session.validateRestoredSession
import com.tran.voting.update.DismissedUpdate
import com.tran.voting.update.InMemoryDismissedUpdate
import com.tran.voting.update.StorePage
import com.tran.voting.update.UpdatePreferences
import kotlinx.coroutines.launch
import uniffi.tran_uniffi.TranAppDestination
import uniffi.tran_uniffi.TranClientStanding
import uniffi.tran_uniffi.TranErrorCode
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranPresentation
import uniffi.tran_uniffi.TranUserAction
import uniffi.tran_uniffi.TranUpdatePromptState
import uniffi.tran_uniffi.TranUserRole
import uniffi.tran_uniffi.updatePrompt

class MainActivity : ComponentActivity() {
    // Notification taps while the activity lives (REQ-PSH-013); a cold start reads the vault anyway.
    private val notificationOpens = NotificationOpens()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Uncaught exceptions are reported, then end the app as before (REQ-ERR-011).
        TranReporting.installUncaughtExceptionHandler()
        enableEdgeToEdge()
        // REQ-SEC-021: the stored session decides the first screen at once, with no network.
        val vault = KeystoreSessionVault(this)
        val initialSession = restoredSession(vault)
        // One API client for the app: its answers say whether this version is still served (spec 028),
        // and the session client reports to the same standing.
        val api = TranApiClient()
        val sessions = SessionClient(vault, http = api.transport, standing = api.standing)
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
        // Spec 027: FCM only in a build with its four values; a staged `notifications` permission
        // stages push too, so a debug run never reaches FCM. Without either, push is unavailable.
        val push = pushGatewayFor(BuildConfig.DEBUG, intent?.getStringExtra(EXTRA_PERMISSION)) { SystemPushGateway(this) }
        val pushStore = PushPreferences(this)
        setContent {
            NavigationCoordinator(
                api = api,
                initialSession = initialSession,
                sessions = sessions,
                dismissedUpdate = UpdatePreferences(this),
                permissions = permissions,
                geocoder = geocoder,
                push = push,
                pushStore = pushStore,
                notificationOpens = notificationOpens,
                // A tap on a notification goes through the director with the stored session (REQ-PSH-013).
                storedSession = { restoredSession(vault) },
                onSignedInChange = { signedIn ->
                    applyPrivacyMeasure(shield, privacyMeasure(signedIn, BuildConfig.DEBUG, shieldOffRequested))
                },
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (isNotificationOpen(intent)) notificationOpens.opened()
    }
}

/**
 * Root Navigation Coordinator implementing the central director and role branching.
 *
 * Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005 REQ-ACC-004 REQ-ACC-006
 * Verifies: REQ-PSH-009 REQ-PSH-011 REQ-PSH-013 REQ-VER-009 REQ-VER-010
 */
@Composable
fun NavigationCoordinator(
    // Screenshot tests start in each registry theme and talk to a canned API (ADR-0031).
    initialTheme: TranTheme = TranTheme.DARK,
    api: TranApiClient = remember { TranApiClient() },
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
    // Push (spec 027). Unavailable unless the app passes FCM or a scenario stages it.
    push: PushGateway = remember { StagedPushGateway() },
    pushStore: PushStore = remember { InMemoryPushStore() },
    notificationOpens: NotificationOpens = remember { NotificationOpens() },
    // Where a notification tap leads: the stored session, through the director. The app reads the
    // vault; without one, the session in memory is the stored one.
    storedSession: (() -> AuthSession)? = null,
    // The version the update prompt was last declined for (REQ-VER-010); the app keeps it in preferences.
    dismissedUpdate: DismissedUpdate = remember { InMemoryDismissedUpdate() },
    // "Update" on the blocking screen and in the prompt; the app opens its store page (REQ-VER-011).
    openStore: (() -> Unit)? = null,
) {
    var session by remember { mutableStateOf(initialSession) }
    val scope = rememberCoroutineScope()
    // Any theme in the rust-core registry can be selected — no light/dark boolean.
    var theme by remember { mutableStateOf(initialTheme) }
    val palette = TranBrandTokens.palette(theme)
    // One feedback center for the app: toasts and confirmations render above every screen.
    val feedback = remember { TranFeedback() }
    val context = LocalContext.current
    val registration = remember(push, permissions, sessions, pushStore) {
        PushRegistration(push, permissions, sessions, pushStore, locale = { context.resources.configuration.locales[0] })
    }
    val reminder = remember(push, permissions, registration) {
        if (push.available) NotificationReminder(permissions, onGranted = { registration.sync(PushTrigger.PERMISSION_GRANTED) }) else null
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // The sync runs at launch (the first start) and on every return to the foreground (REQ-PSH-009).
    DisposableEffect(lifecycle, registration) {
        var launched = false
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) {
                val trigger = if (launched) PushTrigger.FOREGROUND else PushTrigger.LAUNCH
                launched = true
                scope.launch { registration.sync(trigger) }
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    // A new token syncs; a notification in the foreground is the catalogue's toast, never a system
    // notification over the app (REQ-PSH-013).
    DisposableEffect(push, registration, feedback) {
        push.listen(object : PushEvents {
            override fun tokenChanged() {
                scope.launch { registration.sync(PushTrigger.NEW_TOKEN) }
            }

            override fun messageInForeground() {
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                    feedback.acknowledge(TranUserAction.NOTIFICATION_RECEIVED)
                }
            }
        })
        onDispose { push.listen(null) }
    }
    LaunchedEffect(notificationOpens.count) {
        if (notificationOpens.count > 0) {
            tranLogcat(TranLogLevel.DEBUG, "notification opened")
            storedSession?.let { session = it() }
        }
    }
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
            // REQ-PSH-011: the recorded registration goes with the session, before it ends.
            val registered = registration.forget()
            val ended = sessions?.end()
            session = AuthSession.Unauthenticated
            if (sessions != null && ended != null) {
                scope.launch {
                    // The device's own DELETE needs the session, so it goes before the revoke.
                    if (registered) registration.unregisterAfterSignOut(ended)
                    sessions.revoke(ended.refreshToken)
                }
            }
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
                        // The server removed every registration of the user (REQ-PSH-003).
                        registration.forget()
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
    // Spec 028: what the API's answers say about this version. A recommendation is offered once per
    // recommended version, as Rust's `updatePrompt` decides; never over the blocking screen.
    val standing = api.standing
    val update = openStore ?: { StorePage.open(context) }
    val asked = remember { mutableStateOf<String?>(null) }
    LaunchedEffect(standing.recommendation) {
        val recommended = standing.recommendation ?: return@LaunchedEffect
        val state = TranUpdatePromptState(TranClientStanding.UPDATE_RECOMMENDED, recommended.version, dismissedUpdate.version)
        val key = recommended.version.orEmpty()
        if (standing.upgradeRequired || !updatePrompt(state) || asked.value == key) return@LaunchedEffect
        asked.value = key
        feedback.confirm(TranUserAction.UPDATE_RECOMMENDED, onCancel = { dismissedUpdate.version = key }) { update() }
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
          // The catalogue's `screen` for `client.upgrade_required` replaces everything, toasts and
          // dialogs included (REQ-VER-009); the session stays as it is.
          if (standing.upgradeRequired) {
            UpdateRequiredScreen(onUpdate = update)
          } else {
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
                                      registration.sync(PushTrigger.SIGN_IN)
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
                          notifications = reminder,
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
}
