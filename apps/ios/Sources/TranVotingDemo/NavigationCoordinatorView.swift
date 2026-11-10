import SwiftUI

/// Root Coordinator View implementing the Central Navigation Director, launch/splash bootstrap, and role-based branching.
///
/// Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005 REQ-SEC-021 REQ-SEC-023
/// Verifies: REQ-ACC-004 REQ-ACC-005 REQ-ACC-006
/// Verifies: REQ-PSH-009 REQ-PSH-011 REQ-PSH-013
struct NavigationCoordinatorView: View {
    @State private var session: AuthSession
    @State private var isBootstrapping: Bool
    /// The API session behind the device session (ADR-0039 decision 7).
    @State private var sessionClient: TranSessionClient
    /// A session restored from the vault is checked with the server once, in the background.
    private let validatesRestoredSession: Bool
    @Environment(\.scenePhase) private var scenePhase
    /// Any theme in the rust-core registry can be selected — no light/dark boolean. A launch
    /// argument (`-TranTheme sepia`, used by the screenshot tests) picks the starting one.
    @State private var theme: TranTheme =
        UserDefaults.standard.string(forKey: "TranTheme").flatMap(TranTheme.init(rawValue:)) ?? .dark
    /// One feedback center for the app: toasts and confirmations render above every screen.
    @State private var feedback = TranFeedback()
    /// The one account deletion; the "Delete account" control reads whether it is in flight.
    @State private var deletion = TranAccountDeletion()
    /// This installation's push registration, kept right by `pushSync` (spec 027).
    @State private var push: TranPushRegistration
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var palette: TranPalette { TranBrandTokens.palette(for: theme) }

    init(initialSession: AuthSession? = nil) {
        let client: TranSessionClient
        if let initialSession {
            _session = State(initialValue: initialSession)
            _isBootstrapping = State(initialValue: false)
            client = TranSessionClient(vault: InMemorySessionVault())
            validatesRestoredSession = false
        } else if let preset = AuthSession.launchPreset() {
            // Debug-only presets bypass the Keychain (ADR-0039). No stored session boots through
            // the splash; a stored one opens its screen at once.
            _session = State(initialValue: preset ?? .unauthenticated)
            _isBootstrapping = State(initialValue: preset == nil)
            client = TranSessionClient(vault: InMemorySessionVault())
            validatesRestoredSession = false
        } else {
            // The Splash routes from the vault without waiting for the network (REQ-SEC-021).
            let vault = KeychainSessionVault()
            let restored = TranSessionLaunch.restore(vault: vault)
            _session = State(initialValue: restored.session)
            _isBootstrapping = State(initialValue: true)
            client = TranSessionClient(vault: vault)
            validatesRestoredSession = restored.stored != nil
        }
        _sessionClient = State(initialValue: client)
        _push = State(
            initialValue: TranPushRegistration(
                gateway: TranPushLaunch.shared, permissions: TranPermissionLaunch.shared, client: client))
    }

    var body: some View {
        Group {
            if isBootstrapping {
                // Screen 0: Launch / Splash Screen (Navigation Director boots)
                TranScreen {
                    TranStack(gap: .md) {
                        Image(systemName: "hand.raised.fill")
                            .font(.largeTitle)
                            .foregroundStyle(palette.primary)
                        TranText(L10n.Common.brand, variant: .display)
                        ProgressView()
                            .tint(palette.primary)
                            .accessibilityIdentifier(ScreenContract.Splash.splashProgress)
                    }
                }
                .onAppear {
                    // Central director resolves session and transitions
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        withAnimation(TranMotion.animation(reduceMotion: reduceMotion)) {
                            isBootstrapping = false
                        }
                    }
                }
            } else {
                switch session.destination {
                case .splash, .authWelcome:
                    AuthWelcomeView { selectedRole in
                        withAnimation(TranMotion.animation(reduceMotion: reduceMotion)) {
                            session = .authenticated(role: selectedRole)
                        }
                        // Signed in on the device at once; the API session follows when the
                        // API answers. A failure changes nothing here, so it is only logged,
                        // once, by this handler (REQ-ROB-007).
                        let client = sessionClient
                        Task {
                            do {
                                try await client.signIn(role: selectedRole)
                            } catch {
                                feedback.log(TranRequestFailure.classify(error))
                                return
                            }
                            // After sign-in: register this installation to the new session.
                            await push.sync()
                        }
                    }
                case .voterDashboard:
                    VotingHomeView(theme: $theme, onSignOut: signOut, onDeleteAccount: deleteAccount)
                case .auditorDashboard:
                    AuditorHomeView(onSignOut: signOut, onDeleteAccount: deleteAccount)
                }
            }
        }
        .modifier(TranFeedbackHost(feedback: feedback))
        // The app switcher shows no user data (REQ-SEC-023).
        .overlay {
            if TranPrivacyCover.covers(
                sceneIsActive: scenePhase == .active,
                destination: isBootstrapping ? .splash : session.destination)
            {
                PrivacyCoverView()
            }
        }
        // An expired session asks first; "Sign in again" ends it (REQ-ERR-010).
        .onAppear {
            feedback.onErrorConfirmed(.authSessionExpired) {
                withAnimation(TranMotion.animation(reduceMotion: reduceMotion)) {
                    session = .unauthenticated
                }
                endSession()
            }
        }
        // Launch, background half: a dead credential opens the dialog above (REQ-SEC-021).
        .task {
            guard validatesRestoredSession else { return }
            await TranSessionRestore.validate(sessionClient, feedback: feedback)
        }
        // Push (spec 027): sync at launch and whenever the system delivers a token; a tap opens
        // what the navigation director says, and a foreground notification is a toast.
        .task {
            await push.start(
                onOpened: openedFromNotification,
                onForeground: { TranNotificationHandling.arrivedInForeground(feedback) })
        }
        // Back in the foreground: the permission may have changed in Settings (REQ-PSH-009).
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await push.sync() } }
        }
        .environment(feedback)
        .environment(deletion)
        // Atoms read the registry palette from the environment; appearance follows the palette's
        // own metadata (token data, not a theme-name check).
        .environment(\.tranPalette, palette)
        .preferredColorScheme(palette.colorScheme)
    }

    /// Destructive, so the catalogue asks first (REQ-ERR-007).
    private func signOut() {
        feedback.confirm(.signOut) {
            withAnimation(TranMotion.animation(reduceMotion: reduceMotion)) {
                session = .unauthenticated
            }
            endSession()
        }
    }

    /// Forgets the push registration and asks the server to drop it while the session can still
    /// authenticate the call (REQ-PSH-011), then ends the session: the client clears the vault and
    /// the token before it calls the server (REQ-SEC-022). Neither waits on the screen, which has
    /// already changed, and neither failure keeps anyone signed in.
    private func endSession() {
        let client = sessionClient
        let push = push
        Task {
            await push.signOut()
            await client.signOut()
        }
    }

    /// A tap on a notification (REQ-PSH-013): the screen is the one the Rust navigation director
    /// resolves for the stored session (signed out: Auth Welcome), never one the payload names.
    private func openedFromNotification() {
        withAnimation(TranMotion.animation(reduceMotion: reduceMotion)) {
            // The body renders `session.destination`, which is this same answer.
            isBootstrapping = false
        }
    }

    /// Destructive and permanent, so the catalogue asks first (REQ-ACC-005). Unlike sign-out, the
    /// screen changes only after the server confirms (REQ-ACC-006).
    private func deleteAccount(onFailed: @escaping @MainActor (TranRequestFailure) -> Void) {
        deletion.confirm(
            client: sessionClient,
            feedback: feedback,
            onDeleted: {
                withAnimation(TranMotion.animation(reduceMotion: reduceMotion)) {
                    session = .unauthenticated
                }
                // The server dropped every registration; the sync forgets the local record.
                let push = push
                Task { await push.sync() }
            },
            onFailed: onFailed
        )
    }
}
