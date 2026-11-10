// Verifies: REQ-SEC-017 REQ-SEC-019
import XCTest

/// A source guard over the hand-written app code: a token or a session reaches storage only
/// through the Keychain vault. `UserDefaults` is written in one allowlisted place (a launch flag),
/// nothing writes files, and only the vault and the session client handle a token.
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

    func testUserDefaultsIsWrittenOnlyForTheLaunchFlag() throws {
        let writes = try matches(
            #"(\.set\(|\.setValue\([^)]*forKey:|\.register\(defaults|@AppStorage|@SceneStorage|NSUbiquitousKeyValueStore)"#)
        XCTAssertEqual(writes.count, 1, "UserDefaults writes: \(writes)")
        XCTAssertEqual(files(of: writes), ["Session/TranSessionLaunch.swift"])
        XCTAssertTrue(writes.allSatisfy { $0.contains("defaults.set(true, forKey: launchedKey)") }, "\(writes)")
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
