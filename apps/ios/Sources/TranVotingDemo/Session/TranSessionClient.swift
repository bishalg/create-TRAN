// Verifies: REQ-SEC-014 REQ-SEC-015 REQ-SEC-016 REQ-SEC-017 REQ-SEC-021 REQ-SEC-022 REQ-ACC-006 REQ-ROB-007
// Verifies: REQ-PSH-009
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
    /// The outcome of checking a restored session against `GET /api/auth/session`.
    enum Validation: Equatable, Sendable {
        /// The server knows the session.
        case valid
        /// The credential is dead: the vault is cleared and the user must sign in again.
        case signedOut
        /// No verdict (offline, timeout, a server error): keep the device session (REQ-SEC-021).
        case kept
    }

    private let baseUrl: URL
    private let urlSession: URLSession
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
        log: @escaping @Sendable (TranRequestFailure) -> Void = TranFeedback.write
    ) {
        self.vault = vault
        self.baseUrl = baseUrl
        self.urlSession = session
        self.log = log
    }

    /// The answer every expired path ends with; `TranFeedback` presents it as the
    /// `auth.session_expired` dialog.
    static let expired = TranRequestFailure(code: .authSessionExpired, status: 401)

    // MARK: - Sign in and out

    /// `POST /api/auth/session` with the body transport; stores the refresh token in the vault and
    /// keeps the access token in memory. The device session does not wait for this (ADR-0039 7).
    @discardableResult
    func signIn(role: TranUserRole) async throws -> TranStoredSession {
        let body = Self.json(["role": role.wire, "transport": "body"])
        let data = try await send(request("/api/auth/session", method: "POST", body: body))
        return try adopt(data, epoch: epoch)
    }

    /// Clears the vault and the access token first, then revokes on the server. The server call
    /// may fail or never answer; the device is signed out either way (REQ-SEC-022). Nobody hears
    /// of a failed revoke, so this client logs it.
    func signOut() async {
        let stored = vault.load()
        endSession()
        guard let stored else { return }
        let body = Self.json(["refresh_token": stored.refreshToken])
        do {
            _ = try await send(request("/api/auth/sign-out", method: "POST", body: body))
        } catch {
            log(TranRequestFailure.classify(error))
        }
    }

    // MARK: - Delete the account

    /// `DELETE /api/account` (REQ-ACC-006, ADR-0041 decision 4). The opposite order to sign-out:
    /// the device is cleared only once the server answers `2xx`; any failure leaves the vault and
    /// the access token as they were and is thrown for the normal error feedback. A `401` follows
    /// `sessionRecovery` like any other call (REQ-SEC-015).
    func deleteAccount() async throws {
        // Single flight: a second request would answer `401` (the first revoked every session)
        // and raise a misleading session-expired dialog. Callers share the one answer.
        if let running = deletionTask { return try await running.value }
        let task = Task { try await self.performDeletion() }
        deletionTask = task
        defer { deletionTask = nil }
        try await task.value
    }

    private func performDeletion() async throws {
        if accessToken == nil, vault.load() == nil {
            // Nothing to send and nothing to refresh with (the debug launch preset holds no
            // token). Ask the server anyway, so an unreachable API is a network failure and only
            // the server's `401` reaches the recovery table.
            do {
                _ = try await send(request("/api/account", method: "DELETE"))
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
        _ = try await authorized(path: "/api/account", method: "DELETE")
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
            _ = try await authorized(path: "/api/auth/session")
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
    func authorized(path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        var retried = false
        while true {
            let token = accessToken
            var unauthorized: TranRequestFailure?
            if let token {
                do {
                    return try await send(request(path, method: method, body: body, bearer: token))
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
                if accessToken == token { try await refreshOnce() }
                retried = true
            case .signOut:
                endSession()
                // Thrown, so the caller logs it: one event (REQ-ROB-007).
                throw Self.expired
            case .keep:
                // Not a row of the table for a 401; keep the credential and fail this call.
                throw TranRequestFailure(code: .clientUnexpected)
            }
        }
    }

    // MARK: - Refresh

    private func refreshOnce() async throws {
        if let running = refreshTask { return try await running.value }
        let task = Task { try await self.performRefresh() }
        refreshTask = task
        defer { refreshTask = nil }
        try await task.value
    }

    private func performRefresh() async throws {
        guard let stored = vault.load() else {
            // Cleared since the call asked; no request is sent.
            endSession()
            throw Self.expired
        }
        let started = epoch
        let body = Self.json(["refresh_token": stored.refreshToken])
        let data: Data
        do {
            data = try await send(request("/api/auth/refresh", method: "POST", body: body))
        } catch {
            let failure = TranRequestFailure.classify(error)
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

    /// The token-pair answer of sign-in and refresh (`docs/API.md`, body transport).
    private struct TokenPair: Decodable {
        struct User: Decodable {
            let user_id: String
            let role: String
        }
        let access_token: String
        let refresh_token: String
        let user: User
    }

    /// Stores a token pair, unless the session ended while the request was in flight.
    private func adopt(_ data: Data, epoch started: Int) throws -> TranStoredSession {
        guard let pair = try? JSONDecoder().decode(TokenPair.self, from: data),
            TranUserRole(wire: pair.user.role) != nil
        else { throw TranRequestFailure(code: .clientUnexpected) }
        let stored = TranStoredSession(
            refreshToken: pair.refresh_token, userId: pair.user.user_id, roleWire: pair.user.role)
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

    private func request(
        _ path: String, method: String, body: Data? = nil, bearer: String? = nil
    ) -> URLRequest {
        var request = URLRequest(url: baseUrl.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        return request
    }

    /// One request. A failure carries the fixed `LOG_EVENT` fields only, never a header or a
    /// body, so no token can reach a log or a report (REQ-SEC-014). It is thrown, not logged:
    /// whoever ends up handling it logs it once.
    private func send(_ request: URLRequest) async throws -> Data {
        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw TranRequestFailure(code: .clientUnexpected)
            }
            guard (200..<300).contains(http.statusCode) else {
                throw TranRequestFailure.rejected(http, body: data)
            }
            return data
        } catch {
            throw TranRequestFailure.classify(error)
        }
    }

    private static func json(_ object: [String: String]) -> Data {
        // A dictionary of strings always serialises.
        (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
    }
}
