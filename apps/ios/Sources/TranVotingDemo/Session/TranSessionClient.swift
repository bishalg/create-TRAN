// Verifies: REQ-SEC-014 REQ-SEC-015 REQ-SEC-016 REQ-SEC-017 REQ-SEC-021 REQ-SEC-022 REQ-ACC-006 REQ-ROB-007
// Verifies: REQ-PSH-009 REQ-VER-001 REQ-VER-004 REQ-VER-008 REQ-OBS-010 REQ-OBS-011
import Foundation
import os

/// The API session on iOS (spec 022, ADR-0039). Native apps use the body transport: the refresh
/// token arrives in the JSON body and goes to the vault; the access token stays in this actor's
/// memory and is never persisted (REQ-SEC-017). What to do after an auth failure is the Rust
/// table (`sessionRecovery`, `sessionRefreshEvent`), never decided here (REQ-SEC-015).
///
/// One event per failure (REQ-ROB-007), as on Android and the web: a failure this client throws is
/// its caller's to log, once, through the feedback layer (`TranFeedback.report` or `log`); the
/// client logs only a failure it swallows itself (a `401` it recovers from with a refresh, the
/// sign-out revoke, a restored session it keeps).
actor TranSessionClient {
    /// The outcome of checking a restored session against `GET /api/v1/auth/session`.
    enum Validation: Equatable, Sendable {
        /// The server knows the session.
        case valid
        /// The credential is dead: the vault is cleared and the user must sign in again.
        case signedOut
        /// No verdict (offline, timeout, a server error): keep the device session (REQ-SEC-021).
        case kept
    }

    private let http: TranHttp
    private let vault: SessionVault
    private let log: @Sendable (TranRequestFailure) -> Void

    /// In memory only (REQ-SEC-017). After a restart the first call refreshes to get one.
    private var accessToken: String?
    /// The one refresh in flight; concurrent `401`s wait for it (REQ-SEC-016).
    private var refreshTask: Task<Void, Error>?
    /// The one deletion in flight; a second call waits for it (REQ-ACC-006).
    private var deletionTask: Task<Void, Error>?
    /// Bumped whenever the session ends, so a refresh that lands afterwards is discarded.
    private var epoch = 0

    init(
        vault: SessionVault,
        baseUrl: URL = TranApiConfig.baseUrl(),
        session: URLSession = TranApiClient.defaultSession,
        log: @escaping @Sendable (TranRequestFailure) -> Void = TranFeedback.write,
        client: String = TranClientIdentity.current,
        onStanding: @escaping @Sendable (TranStandingSignal) -> Void = TranUpdateCenter.post
    ) {
        self.vault = vault
        self.http = TranHttp(baseUrl: baseUrl, session: session, client: client, onStanding: onStanding)
        self.log = log
    }

    /// The answer every expired path ends with; `TranFeedback` presents it as the
    /// `auth.session_expired` dialog.
    static let expired = TranRequestFailure(code: .authSessionExpired, status: 401)

    // MARK: - Sign in and out

    /// `POST /api/v1/auth/session` with the body transport; stores the refresh token in the vault and
    /// keeps the access token in memory. The device session does not wait for this (ADR-0039 7).
    @discardableResult
    func signIn(role: TranUserRole, traceId: String? = nil) async throws -> TranStoredSession {
        let body = Self.json(["role": role.wire, "transport": "body"])
        let tid = traceId ?? TranRetry.newTraceId()
        let span = TranRetry.newChildSpan(traceId: tid)
        let tp = span.map { formatTraceparentOffline(context: $0) }
        let data = try await send(http.request(.signIn, body: body, traceparent: tp))
        return try adopt(data, epoch: epoch)
    }

    /// Clears the vault and the access token first, then revokes on the server. The server call
    /// may fail or never answer; the device is signed out either way (REQ-SEC-022). Nobody hears
    /// of a failed revoke, so this client logs it.
    func signOut(traceId: String? = nil) async {
        let stored = vault.load()
        endSession()
        guard let stored else { return }
        let body = Self.json(["refresh_token": stored.refreshToken])
        let tid = traceId ?? TranRetry.newTraceId()
        let span = TranRetry.newChildSpan(traceId: tid)
        let tp = span.map { formatTraceparentOffline(context: $0) }
        do {
            _ = try await send(http.request(.signOut, body: body, traceparent: tp))
        } catch {
            log(TranRequestFailure.classify(error, traceId: tid))
        }
    }

    // MARK: - Delete the account

    /// `DELETE /api/v1/account` (REQ-ACC-006, ADR-0041 decision 4). The opposite order to sign-out:
    /// the device is cleared only once the server answers `2xx`; any failure leaves the vault and
    /// the access token as they were and is thrown for the normal error feedback. A `401` follows
    /// `sessionRecovery` like any other call (REQ-SEC-015).
    func deleteAccount(traceId: String? = nil) async throws {
        // Single flight: a second request would answer `401` (the first revoked every session)
        // and raise a misleading session-expired dialog. Callers share the one answer.
        if let running = deletionTask { return try await running.value }
        let task = Task { try await self.performDeletion(traceId: traceId) }
        deletionTask = task
        defer { deletionTask = nil }
        try await task.value
    }

    private func performDeletion(traceId: String? = nil) async throws {
        if accessToken == nil, vault.load() == nil {
            // Nothing to send and nothing to refresh with (the debug launch preset holds no
            // token). Ask the server anyway, so an unreachable API is a network failure and only
            // the server's `401` reaches the recovery table.
            let tid = traceId ?? TranRetry.newTraceId()
            let span = TranRetry.newChildSpan(traceId: tid)
            let tp = span.map { formatTraceparentOffline(context: $0) }
            do {
                _ = try await send(http.request(.deleteAccount, traceparent: tp))
                endSession()
                return
            } catch let failure as TranRequestFailure where failure.status == 401 {
                // The table decides what it means (REQ-SEC-015); whatever is thrown, the caller logs.
                let event = TranSessionEvent.unauthorized(hasRefreshCredential: false, alreadyRetried: false)
                guard case .signOut = sessionRecovery(event: event) else { throw failure }
                endSession()
                throw Self.expired
            }
        }
        _ = try await authorized(.deleteAccount, traceId: traceId)
        endSession()
    }

    // MARK: - Authorised calls

    /// Whether there is an API session to authenticate a call with: an access token in memory or
    /// a refresh credential in the vault. The device registration needs one (REQ-PSH-009).
    func hasApiSession() -> Bool {
        accessToken != nil || vault.load() != nil
    }

    /// Checks a restored session in the background (REQ-SEC-021). Only a dead credential signs
    /// the user out; an unreachable API keeps them signed in. A kept failure is shown nowhere, so
    /// this client logs it; `.signedOut` is the caller's to log, as it presents it.
    func validate() async -> Validation {
        do {
            _ = try await authorized(.validateSession)
            return .valid
        } catch let failure as TranRequestFailure where failure == Self.expired {
            return .signedOut
        } catch {
            log(TranRequestFailure.classify(error))
            return .kept
        }
    }

    /// Sends an API call with `Authorization: Bearer`. On `401` it follows `sessionRecovery`:
    /// one shared refresh, then the call repeats once with the new token (REQ-SEC-016).
    func authorized(
        _ endpoint: TranEndpoint, installationId: String? = nil, body: Data? = nil, traceId: String? = nil
    ) async throws -> Data {
        var retried = false
        let tid = traceId ?? TranRetry.newTraceId()
        while true {
            let token = accessToken
            var unauthorized: TranRequestFailure?
            if let token {
                do {
                    let span = TranRetry.newChildSpan(traceId: tid)
                    let tp = span.map { formatTraceparentOffline(context: $0) }
                    return try await send(
                        http.request(endpoint, installationId: installationId, body: body, bearer: token, traceparent: tp))
                } catch let failure as TranRequestFailure where failure.status == 401 {
                    // Falls through to the recovery table below.
                    unauthorized = failure
                }
            }
            // A 401, or no access token yet (a restored session): the same question.
            let event = TranSessionEvent.unauthorized(
                hasRefreshCredential: vault.load() != nil, alreadyRetried: retried)
            switch sessionRecovery(event: event) {
            case .refresh:
                // The 401 ends here, recovered by a refresh: swallowed, so this client logs it.
                if let unauthorized { log(unauthorized) }
                // Another call may already have refreshed since this one was sent.
                if accessToken == token { try await refreshOnce(traceId: tid) }
                retried = true
            case .signOut:
                endSession()
                // Thrown, so the caller logs it: one event (REQ-ROB-007).
                throw Self.expired
            case .keep:
                // Not a row of the table for a 401; keep the credential and fail this call.
                throw TranRequestFailure(code: .clientUnexpected, traceId: tid)
            }
        }
    }

    // MARK: - Refresh

    private func refreshOnce(traceId: String? = nil) async throws {
        if let running = refreshTask { return try await running.value }
        let task = Task { try await self.performRefresh(traceId: traceId) }
        refreshTask = task
        defer { refreshTask = nil }
        try await task.value
    }

    private func performRefresh(traceId: String? = nil) async throws {
        guard let stored = vault.load() else {
            // Cleared since the call asked; no request is sent.
            endSession()
            throw Self.expired
        }
        let started = epoch
        let body = Self.json(["refresh_token": stored.refreshToken])
        let tid = traceId ?? TranRetry.newTraceId()
        let span = TranRetry.newChildSpan(traceId: tid)
        let tp = span.map { formatTraceparentOffline(context: $0) }
        let data: Data
        do {
            data = try await send(http.request(.refresh, body: body, traceparent: tp))
        } catch {
            let failure = TranRequestFailure.classify(error, traceId: tid)
            let status = failure.status.map { UInt16(clamping: $0) }
            // `nil` means success, which cannot reach this branch.
            let event = sessionRefreshEvent(status: status) ?? .refreshFailed
            switch sessionRecovery(event: event) {
            case .signOut:
                endSession()
                throw Self.expired
            case .keep, .refresh:
                throw failure
            }
        }
        // A 2xx we cannot use keeps the credential, like any other failed refresh.
        _ = try adopt(data, epoch: started)
    }

    // MARK: - Plumbing

    /// The token-pair answer of sign-in and refresh (`docs/API.md`, body transport): every field
    /// the app reads, nothing more, so a newer server's extra fields are ignored (REQ-VER-008).
    /// `ClientManifestTests` holds the iOS manifest's `reads` to these fields.
    struct TokenPair: Decodable {
        struct User: Decodable {
            let user_id: String
            /// Read tolerantly: a role this build does not know is the catalogue's fallback.
            let role: String

            init(from decoder: Decoder) throws {
                let container = try decoder.container(keyedBy: CodingKeys.self)
                user_id = try container.decode(String.self, forKey: .user_id)
                role = Self.role(try container.decode(String.self, forKey: .role))
            }

            private enum CodingKeys: String, CodingKey { case user_id, role }

            /// `decodeWireEnum` over the generated `user_role` table (REQ-VER-008).
            static func role(_ raw: String) -> String {
                decodeWireEnum(name: "user_role", raw: raw) ?? ApiContract.WireEnums.UserRole.fallback
            }
        }
        let access_token: String
        /// Always present on the body transport the app signs in with; a pair without it is not
        /// adopted, but still decodes, as the cookie transport's answer does.
        let refresh_token: String?
        let user: User
    }

    /// Stores a token pair, unless the session ended while the request was in flight.
    private func adopt(_ data: Data, epoch started: Int) throws -> TranStoredSession {
        guard let pair = try? JSONDecoder().decode(TokenPair.self, from: data),
            let refreshToken = pair.refresh_token, TranUserRole(wire: pair.user.role) != nil
        else { throw TranRequestFailure(code: .clientUnexpected) }
        let stored = TranStoredSession(
            refreshToken: refreshToken, userId: pair.user.user_id, roleWire: pair.user.role)
        guard started == epoch else { throw Self.expired }
        do {
            try vault.save(stored)
        } catch {
            throw TranRequestFailure(code: .clientUnexpected)
        }
        accessToken = pair.access_token
        return stored
    }

    private func endSession() {
        epoch += 1
        accessToken = nil
        vault.clear()
    }

    private func send(_ request: URLRequest) async throws -> Data {
        try await http.send(request)
    }

    private static func json(_ object: [String: String]) -> Data {
        // A dictionary of strings always serialises.
        (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
    }
}
