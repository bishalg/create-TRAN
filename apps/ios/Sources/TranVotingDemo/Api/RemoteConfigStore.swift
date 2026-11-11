// Verifies: REQ-CFG-002 REQ-CFG-005 REQ-CFG-006 REQ-CFG-007 REQ-CFG-008 REQ-DB-011
import Foundation

/// Remote configuration store for iOS (spec 029, ADR-0048).
/// Starts with compiled defaults or stored configuration, never blocks, and fetches in the background.
public final class RemoteConfigStore: @unchecked Sendable {
    public static let shared = RemoteConfigStore()

    private let userDefaults: UserDefaults
    private let session: URLSession
    private let baseUrl: URL?
    private let storageKey = "tran.remote_config"
    private let etagKey = "tran.remote_config_etag"

    private let lock = NSLock()
    private var launchFlags: [String: Any]
    private var liveFlags: [String: Any]
    private var clientThresholds: (minimum: String?, recommended: String?)
    private var configVersion: Int

    public init(
        userDefaults: UserDefaults = .standard,
        session: URLSession = .shared,
        baseUrl: URL? = nil
    ) {
        self.userDefaults = userDefaults
        self.session = session
        self.baseUrl = baseUrl

        var initial: [String: Any] = [Flags.notifyMeId: Flags.notifyMeDefault]
        var initialThresholds: (String?, String?) = (nil, nil)
        var initialVersion = 1

        if let data = userDefaults.data(forKey: storageKey),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let schema = json["schema"] as? Int ?? 1
            let decision = tranStoredRecordDecision(schema: UInt32(schema), current: tranStoredConfigSchema())
            if decision != .discard {
                if let flags = json["flags"] as? [String: Any] {
                    for (k, v) in flags {
                        initial[k] = v
                    }
                }
                if let client = json["client"] as? [String: Any] {
                    initialThresholds = (client["minimum_version"] as? String, client["recommended_version"] as? String)
                }
                if let v = json["config_version"] as? Int {
                    initialVersion = v
                }
            }
        }

        self.launchFlags = initial
        self.liveFlags = initial
        self.clientThresholds = initialThresholds
        self.configVersion = initialVersion
    }

    /// Whether the notify_me reminder flag is active (live flag) (REQ-CFG-007).
    public var isNotifyMe: Bool {
        lock.lock()
        defer { lock.unlock() }
        return Flags.notifyMe(from: liveFlags)
    }

    /// Current client minimum and recommended thresholds (REQ-CFG-008).
    public var thresholds: (minimum: String?, recommended: String?) {
        lock.lock()
        defer { lock.unlock() }
        return clientThresholds
    }

    /// Configuration version returned by the server.
    public var version: Int {
        lock.lock()
        defer { lock.unlock() }
        return configVersion
    }

    /// Non-blocking background fetch with ETag support (REQ-CFG-005).
    @discardableResult
    public func fetchInBackground(clientHeader: String? = nil, bucket: UInt8? = nil) async -> Bool {
        guard let baseUrl = baseUrl else { return false }
        var request = URLRequest(url: baseUrl.appendingPathComponent("api/v1/config"))
        request.httpMethod = "GET"
        if let clientHeader = clientHeader {
            request.setValue(clientHeader, forHTTPHeaderField: ApiContract.clientHeader)
        }
        if let bucket = bucket {
            request.setValue(String(bucket), forHTTPHeaderField: "X-Tran-Bucket")
        }
        if let etag = userDefaults.string(forKey: etagKey) {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return false }
            if http.statusCode == 304 { return false }
            guard http.statusCode == 200 else { return false }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let flags = json["flags"] as? [String: Any] else {
                return false
            }

            var payload = json
            payload["schema"] = Int(tranStoredConfigSchema())
            if let payloadData = try? JSONSerialization.data(withJSONObject: payload) {
                userDefaults.set(payloadData, forKey: storageKey)
            } else {
                userDefaults.set(data, forKey: storageKey)
            }
            if let etag = http.value(forHTTPHeaderField: "ETag") {
                userDefaults.set(etag, forKey: etagKey)
            }

            lock.lock()
            for (k, v) in flags {
                self.liveFlags[k] = v
            }
            if let version = json["config_version"] as? Int {
                self.configVersion = version
            }
            if let client = json["client"] as? [String: Any] {
                self.clientThresholds = (client["minimum_version"] as? String, client["recommended_version"] as? String)
            }
            lock.unlock()

            return true
        } catch {
            return false
        }
    }
}
