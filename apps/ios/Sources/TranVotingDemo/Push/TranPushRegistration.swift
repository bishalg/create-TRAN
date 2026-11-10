// Verifies: REQ-PSH-009 REQ-PSH-010 REQ-PSH-011
import Foundation

/// Keeps this installation's registration with the API right (spec 027, ADR-0044). What to do is
/// `pushSync`, the Rust table (REQ-PSH-009); this only gathers the state and carries out the answer:
/// `PUT /api/devices/{installation_id}` through the session client, or clear the record and a
/// best-effort `DELETE`. It runs at launch, on return to the foreground, when a token arrives and
/// after sign-in. Every call is in the background: a failure is logged once, through the feedback
/// layer's writer, and shown nowhere. No token or installation id reaches a log (REQ-PSH-007).
@MainActor
final class TranPushRegistration {
    /// The values every registration carries besides the token (`docs/API.md`).
    struct App: Equatable, Sendable {
        /// `sandbox` or `production`, from the build (`TranPushBuild`).
        let environment: String
        /// The language the app shows, as a language tag (`en`, `ne`, `hi`).
        let locale: String
        /// `CFBundleShortVersionString`.
        let version: String

        static var current: App {
            let language = Bundle.main.preferredLocalizations.first ?? "en"
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
            return App(
                environment: TranPushBuild.current.environment,
                locale: language.replacingOccurrences(of: "_", with: "-"),
                version: version ?? "0"
            )
        }
    }

    private let gateway: PushGateway
    private let permissions: PermissionGateway
    private let client: TranSessionClient
    private let store: TranPushStore
    private let app: App
    private let now: () -> Date
    private let log: (TranRequestFailure) -> Void
    /// The sync in flight; the next one waits for it, so two never race on the record.
    private var tail: Task<TranPushAction, Never>?

    init(
        gateway: PushGateway,
        permissions: PermissionGateway,
        client: TranSessionClient,
        store: TranPushStore = TranPushStore(),
        app: App = .current,
        now: @escaping () -> Date = Date.init,
        log: @escaping (TranRequestFailure) -> Void = TranFeedback.write
    ) {
        self.gateway = gateway
        self.permissions = permissions
        self.client = client
        self.store = store
        self.app = app
        self.now = now
        self.log = log
    }

    /// The sync a delivered token started, so a test can wait for it.
    private(set) var tokenSync: Task<TranPushAction, Never>?

    /// Launch: listens to the gateway, then runs the first sync. A new token runs the sync again;
    /// a tap and a foreground notification go to the caller (REQ-PSH-013).
    func start(onOpened: @escaping () -> Void, onForeground: @escaping () -> Void) async {
        // The installation id exists from the first launch (REQ-PSH-010), whether or not push is on.
        _ = store.installationId
        gateway.onEvent = { [weak self] event in
            switch event {
            case .tokenArrived:
                guard let self else { return }
                self.tokenSync = Task { await self.sync() }
            case .opened:
                onOpened()
            case .arrivedInForeground:
                onForeground()
            }
        }
        await sync()
    }

    /// Runs `pushSync` once and carries out its answer; returns the answer.
    @discardableResult
    func sync() async -> TranPushAction {
        let previous = tail
        let task = Task { [self] in
            _ = await previous?.value
            return await performSync()
        }
        tail = task
        return await task.value
    }

    /// Sign-out (REQ-PSH-011): forget the registration, then a best-effort `DELETE` while the
    /// session can still authenticate it. Call it before the session client signs out; whatever
    /// happens here, the sign-out goes ahead, and the server drops the session's registrations
    /// anyway (REQ-PSH-003).
    func signOut() async {
        _ = await tail?.value
        let recorded = store.lastRegistration != nil
        store.clear()
        guard recorded, await client.hasApiSession() else { return }
        await unregisterOnServer()
    }

    private func performSync() async -> TranPushAction {
        let available = gateway.isAvailable
        let granted = available ? Self.granted(await permissions.status(of: .notifications)) : false
        let hasSession = await client.hasApiSession()
        // The token comes from the system only when asked; every launch asks again.
        if available, granted, gateway.token == nil { gateway.registerForPush() }
        // A token from another device than the one the id was made on gets a new id (REQ-PSH-010).
        if let token = gateway.token { store.bind(token: token) }
        let nowUnixS = Int64(now().timeIntervalSince1970)
        let state = TranPushState(
            pushAvailable: available,
            permissionGranted: granted,
            hasSession: hasSession,
            currentToken: gateway.token,
            lastRegistration: store.lastRegistration,
            nowUnixS: nowUnixS
        )
        let action = pushSync(state: state)
        switch action {
        case .register:
            if let token = state.currentToken { await register(token, at: nowUnixS) }
        case .unregister:
            store.clear()
            // Without a session there is nothing to authenticate the call with, and the server
            // removed the session's registrations when it ended (REQ-PSH-003).
            if hasSession { await unregisterOnServer() }
        case .nothing:
            break
        }
        return action
    }

    private static func granted(_ status: TranPermissionStatus) -> Bool {
        status == .granted || status == .grantedApproximate
    }

    private var path: String { "/api/devices/\(store.installationId)" }

    private func register(_ token: String, at nowUnixS: Int64) async {
        let body: [String: Any] = [
            "platform": "ios",
            "push_token": token,
            "environment": app.environment,
            "locale": app.locale,
            "app_version": app.version,
            "marketing": false,
        ]
        do {
            let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
            _ = try await client.authorized(path: path, method: "PUT", body: data)
            store.record(TranLastRegistration(token: token, registeredAtUnixS: nowUnixS))
        } catch {
            log(TranRequestFailure.classify(error))
        }
    }

    private func unregisterOnServer() async {
        do {
            _ = try await client.authorized(path: path, method: "DELETE")
        } catch {
            log(TranRequestFailure.classify(error))
        }
    }
}
