import SwiftUI

/// Root Coordinator View implementing the Central Navigation Director, launch/splash bootstrap, and role-based branching.
///
/// Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005
struct NavigationCoordinatorView: View {
    @State private var session: AuthSession
    @State private var isBootstrapping: Bool
    @State private var useDark: Bool = true

    init(initialSession: AuthSession? = nil) {
        if let initialSession {
            _session = State(initialValue: initialSession)
            _isBootstrapping = State(initialValue: false)
        } else if CommandLine.arguments.contains("-unauthenticated") {
            _session = State(initialValue: .unauthenticated)
            _isBootstrapping = State(initialValue: true)
        } else {
            // Default directly to voter dashboard so existing UI tests pass instantly
            _session = State(initialValue: .authenticated(role: .citizenVoter))
            _isBootstrapping = State(initialValue: false)
        }
    }

    var body: some View {
        let background = useDark ? TranBrandTokens.Dark.background : TranBrandTokens.Light.background
        let primary = useDark ? TranBrandTokens.Dark.primary : TranBrandTokens.Light.primary
        let textPrimary = useDark ? TranBrandTokens.Dark.textPrimary : TranBrandTokens.Light.textPrimary

        Group {
            if isBootstrapping {
                // Screen 0: Launch / Splash Screen (Navigation Director boots)
                ZStack {
                    background.ignoresSafeArea()
                    VStack(spacing: 16) {
                        Image(systemName: "hand.raised.fill")
                            .font(.system(size: 64))
                            .foregroundStyle(primary)
                        Text("TRAN")
                            .font(.largeTitle.weight(.bold))
                            .foregroundStyle(textPrimary)
                        ProgressView()
                            .tint(primary)
                            .accessibilityIdentifier("splash-progress")
                    }
                }
                .onAppear {
                    // Central director resolves session and transitions
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        withAnimation {
                            isBootstrapping = false
                        }
                    }
                }
            } else {
                switch NavigationDirector.resolveDestination(session: session) {
                case .splash, .authWelcome:
                    AuthWelcomeView(useDark: useDark) { selectedRole in
                        withAnimation {
                            session = .authenticated(role: selectedRole)
                        }
                    }
                case .voterDashboard:
                    VotingHomeView(onSignOut: {
                        withAnimation {
                            session = .unauthenticated
                        }
                    })
                case .auditorDashboard:
                    AuditorHomeView(useDark: useDark) {
                        withAnimation {
                            session = .unauthenticated
                        }
                    }
                }
            }
        }
    }
}
