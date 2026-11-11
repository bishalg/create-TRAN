// Verifies: REQ-SEC-017 REQ-SEC-019 REQ-PSH-010 REQ-VER-010
import XCTest

/// A source guard over the hand-written app code: a token or a session reaches storage only
/// through the Keychain vault. `UserDefaults` is written in four allowlisted places (a launch flag; the config cache;
/// the push store; the dismissed update prompt), nothing writes files, and only the vault and the session client handle a token.
final class SessionVaultGuardTests: XCTestCase {
    private static let sources = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Sources/TranVotingDemo")

    /// Hand-written Swift files (generated code is excluded), by path relative to `sources`.
    private func handWritten() throws -> [(path: String, text: String)] {
        let root = Self.sources.standardizedFileURL.path
        let walker = try XCTUnwrap(FileManager.default.enumerator(atPath: root))
        var files: [(String, String)] = []
        for case let path as String in walker where path.hasSuffix(".swift") && !path.hasPrefix("Generated/") {
            files.append((path, try String(contentsOfFile: "\(root)/\(path)", encoding: .utf8)))
        }
        XCTAssertGreaterThan(files.count, 10, "found no sources under \(root)")
        return files
    }

    /// Lines of every hand-written file matching `pattern`, as `path: line`.
    private func matches(_ pattern: String) throws -> [String] {
        let regex = try NSRegularExpression(pattern: pattern)
        return try handWritten().flatMap { file in
            file.text.split(separator: "\n", omittingEmptySubsequences: false).enumerated().compactMap {
                index, line -> String? in
                let text = String(line)
                let range = NSRange(text.startIndex..., in: text)
                guard regex.firstMatch(in: text, range: range) != nil else { return nil }
                return "\(file.path):\(index + 1): \(text.trimmingCharacters(in: .whitespaces))"
            }
        }
    }

    private func files(of lines: [String]) -> Set<String> {
        Set(lines.map { String($0.prefix { $0 != ":" }) })
    }

    /// The writes allowed, each with its reason. The launch flag is only a flag. The push store
    /// keeps the installation id, the token it is bound to and the last registration (spec 027):
    /// none of them is a credential (the id is random and only tells installs apart, a push token
    /// is an address, not a secret), so they belong in ordinary app storage, not the Keychain
    /// (REQ-PSH-010). The update center keeps the recommended version the prompt was dismissed for,
    /// a version number and nothing else: a preference, as the web keeps it in Web Storage
    /// (REQ-VER-010). The remote config store caches the server's public configuration (flags,
    /// version thresholds) and its ETag (REQ-CFG-005), which every client may read. No session,
    /// refresh or access token may join this list.
    private static let allowedWrites: [String: [String]] = [
        "Session/TranSessionLaunch.swift": ["defaults.set(true, forKey: launchedKey)"],
        "Push/TranPushStore.swift": [
            "defaults.set(created, forKey: Self.installationKey)",
            "defaults.set(token, forKey: Self.boundTokenKey)",
            "defaults.set(UUID().uuidString.lowercased(), forKey: Self.installationKey)",
            "defaults.set(Int(tranStoredPushSchema()), forKey: Self.schemaKey)",
            "defaults.set(registration.token, forKey: Self.tokenKey)",
            "defaults.set(NSNumber(value: registration.registeredAtUnixS), forKey: Self.registeredAtKey)",
        ],
        "Api/RemoteConfigStore.swift": [
            "userDefaults.set(payloadData, forKey: storageKey)",
            "userDefaults.set(data, forKey: storageKey)",
            "userDefaults.set(etag, forKey: etagKey)",
        ],
        "Api/TranUpdateCenter.swift": [
            #"defaults.set(offer.recommendedVersion ?? "", forKey: Self.dismissedKey)"#
        ],
    ]

    func testUserDefaultsIsWrittenOnlyForTheLaunchFlagThePushStoreTheConfigCacheAndTheUpdatePrompt() throws {
        let writes = try matches(
            #"(\.set\(|\.setValue\([^)]*forKey:|\.register\(defaults|@AppStorage|@SceneStorage|NSUbiquitousKeyValueStore)"#)
        XCTAssertEqual(files(of: writes), Set(Self.allowedWrites.keys), "UserDefaults writes: \(writes)")
        let found = writes.map { line in String(line.split(separator: ":", maxSplits: 2)[2]).trimmingCharacters(in: .whitespaces) }
        XCTAssertEqual(found.sorted(), Self.allowedWrites.values.flatMap { $0 }.sorted(), "\(writes)")
    }

    /// The push store never holds the session: no vault, refresh or access token passes through it.
    func testThePushStoreKeepsNoSessionCredential() throws {
        let store = try String(
            contentsOf: Self.sources.appendingPathComponent("Push/TranPushStore.swift"), encoding: .utf8)
        for credential in ["refresh", "TranStoredSession", "SessionVault", "Bearer"] {
            XCTAssertFalse(store.contains(credential), "the push store mentions \(credential)")
        }
    }

    /// The update center stores a version number only: no session, token or vault passes through it.
    func testTheUpdatePromptKeepsOnlyAVersion() throws {
        let center = try String(
            contentsOf: Self.sources.appendingPathComponent("Api/TranUpdateCenter.swift"), encoding: .utf8)
        for credential in ["refresh", "token", "Token", "TranStoredSession", "SessionVault", "Bearer"] {
            XCTAssertFalse(center.contains(credential), "the update center mentions \(credential)")
        }
        // One read and one write of the key, both in the update center.
        let uses = try matches(#"forKey: Self\.dismissedKey"#)
        XCTAssertEqual(files(of: uses), ["Api/TranUpdateCenter.swift"])
        XCTAssertEqual(uses.count, 2, "\(uses)")
    }

    func testNothingWritesAFile() throws {
        let writes = try matches(
            #"(\.write\(to|\.write\(toFile|createFile\(|NSKeyedArchiver|FileHandle\(forWriting|\.archivedData\()"#)
        XCTAssertEqual(writes, [], "a credential must never reach a file")
    }

    func testOnlyTheVaultTouchesTheKeychain() throws {
        let keychain = try matches(#"(SecItemAdd|SecItemUpdate|SecItemCopyMatching|SecItemDelete|kSecClass)"#)
        XCTAssertEqual(files(of: keychain), ["Session/KeychainSessionVault.swift"])
    }

    /// The access token is a property of the session client and nothing else (REQ-SEC-017).
    func testOnlyTheSessionClientHoldsTheAccessToken() throws {
        let holders = try matches(#"accessToken|access_token"#)
        XCTAssertEqual(files(of: holders), ["Session/TranSessionClient.swift"])
        let vault = try String(
            contentsOf: Self.sources.appendingPathComponent("Session/SessionVault.swift"), encoding: .utf8)
        let fields = try NSRegularExpression(pattern: #"\b(let|var)\s+\w*[Aa]ccess"#)
        XCTAssertNil(
            fields.firstMatch(in: vault, range: NSRange(vault.startIndex..., in: vault)),
            "the stored record has no access-token field")
    }

    /// Nothing prints a token: no `print`, `NSLog` or `dump` in app code, and loggers write only
    /// the fixed `logLine` fields.
    func testNoTokenIsPrinted() throws {
        XCTAssertEqual(try matches(#"(^|[^.\w])(print|debugPrint|NSLog|dump)\("#), [])
        let logged = try matches(#"logger\.(debug|info|warning|error|notice|log)\("#)
        XCTAssertTrue(logged.allSatisfy { $0.contains("(message, privacy: .public)") }, "\(logged)")
    }
}
