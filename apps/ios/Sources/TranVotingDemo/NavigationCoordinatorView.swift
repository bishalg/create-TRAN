import SwiftUI

/// Root Coordinator View implementing the Central Navigation Director, launch/splash bootstrap, and role-based branching.
///
/// Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005 REQ-SEC-021 REQ-SEC-023
/// Verifies: REQ-ACC-004 REQ-ACC-005 REQ-ACC-006
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var palette: TranPalette { TranBrandTokens.palette(for: theme) }

    init(initialSession: AuthSession? = nil) {
        if let initialSession {
            _session = State(initialValue: initialSession)
            _isBootstrapping = State(initialValue: false)
            _sessionClient = State(initialValue: TranSessionClient(vault: InMemorySessionVault()))
            validatesRestoredSession = false
        } else if let preset = AuthSession.launchPreset() {
            // Debug-only presets bypass the Keychain (ADR-0039). No stored session boots through
            // the splash; a stored one opens its screen at once.
            _session = State(initialValue: preset ?? .unauthenticated)
            _isBootstrapping = State(initialValue: preset == nil)
            _sessionClient = State(initialValue: TranSessionClient(vault: InMemorySessionVault()))
            validatesRestoredSession = false
        } else {
            // The Splash routes from the vault without waiting for the network (REQ-SEC-021).
            let vault = KeychainSessionVault()
            let restored = TranSessionLaunch.restore(vault: vault)
            _session = State(initialValue: restored.session)
            _isBootstrapping = State(initialValue: true)
            _sessionClient = State(initialValue: TranSessionClient(vault: vault))
            validatesRestoredSession = restored.stored != nil
        }
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
                            }
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
                let client = sessionClient
                Task { await client.signOut() }
            }
        }
        // Launch, background half: a dead credential opens the dialog above (REQ-SEC-021).
        .task {
            guard validatesRestoredSession else { return }
            await TranSessionRestore.validate(sessionClient, feedback: feedback)
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
            // The client clears the vault and the token before it calls the server (REQ-SEC-022).
            let client = sessionClient
            Task { await client.signOut() }
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
            },
            onFailed: onFailed
        )
    }
}
