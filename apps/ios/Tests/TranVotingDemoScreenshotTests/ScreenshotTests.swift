// Verifies: REQ-PERF-007
import CoreGraphics
import UIKit
import XCTest

/// The real app on a simulator, in every registry theme × every locale, walked through its screens
/// and compared with this machine's references (ADR-0031). References live in
/// `apps/ios/.screenshots/<model>-<iOS version>/` (gitignored); a missing one is recorded and the
/// shot passes, so the first run on a machine is its baseline. `pnpm ios:screenshots:record`
/// re-records all of them after an intended change.
///
/// The API points at a refused port, so every run ends in the same state: "offline" pill and banner.
/// `pnpm ios:screenshots` also pins the simulator's status bar, so the clock never differs.
final class ScreenshotTests: XCTestCase {
    /// `apps/ios`, found from this file — the simulator shares the Mac's file system.
    private static let iosRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    private static var device: String {
        let env = ProcessInfo.processInfo.environment
        let model = env["SIMULATOR_MODEL_IDENTIFIER"] ?? "device"
        return "\(model)-iOS\(env["SIMULATOR_RUNTIME_VERSION"] ?? UIDevice.current.systemVersion)"
    }

    private static let references = iosRoot.appendingPathComponent(".screenshots/\(device)")
    private static let failures = iosRoot.appendingPathComponent("build/screenshots/\(device)")
    private static let record = ProcessInfo.processInfo.environment["TRAN_SCREENSHOTS_RECORD"] == "1"
    /// `TRAN_SCREENSHOTS_ONLY=sepia-ne` runs one combination while working on a screen.
    private static let only = ProcessInfo.processInfo.environment["TRAN_SCREENSHOTS_ONLY"].flatMap { $0.isEmpty ? nil : $0 }

    /// The same locale list every platform ships: the folders under `locales/`.
    private static var locales: [String] {
        let dir = iosRoot.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("locales")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return names.filter { !$0.hasPrefix(".") }.sorted()
    }

    private let timeout: TimeInterval = 15

    func testEveryThemeAndLocale() throws {
        continueAfterFailure = true
        let locales = Self.locales
        XCTAssertFalse(locales.isEmpty, "no locales found next to \(Self.iosRoot.path)")
        for theme in TranTheme.allCases {
            for locale in locales where Self.only == nil || Self.only == "\(theme.rawValue)-\(locale)" {
                XCTContext.runActivity(named: "\(theme.rawValue)-\(locale)") { _ in
                    walk(theme: theme.rawValue, locale: locale)
                }
            }
        }
    }

    /// Home → result → sign-out dialog → welcome → auditor, one shot each.
    private func walk(theme: String, locale: String) {
        let name = "\(theme)-\(locale)"
        let app = XCUIApplication()
        app.launchArguments += [
            "-TranTheme", theme,
            "-AppleLanguages", "(\(locale))",
            "-AppleLocale", locale,
            "-TranApiBaseUrl", "http://127.0.0.1:1",
        ]
        app.launch()
        defer { app.terminate() }

        guard wait(for: app.descendants(matching: .any)["offline-notice"], "the offline banner", name) else { return }
        compare("home-\(name)")

        app.buttons["check-button"].tap()
        guard wait(for: app.staticTexts["offline-result"], "the result", name) else { return }
        compare("result-\(name)")

        app.buttons["sign-out-button"].tap()
        guard wait(for: app.alerts.firstMatch, "the sign-out dialog", name) else { return }
        compare("sign-out-dialog-\(name)")

        // By position, so any locale works: Cancel, then the confirm. (An identifier on an alert
        // button makes iOS expose that button twice, which breaks every query for it.)
        let buttons = app.alerts.firstMatch.buttons
        XCTAssertEqual(buttons.count, 2, "\(name): the sign-out dialog should offer Cancel and Sign out")
        buttons.element(boundBy: 1).tap()
        guard wait(for: app.buttons["auditor-branch-button"], "the welcome screen", name) else { return }
        compare("welcome-\(name)")

        app.buttons["auditor-branch-button"].tap()
        guard wait(for: app.buttons["sign-out-button"], "the auditor screen", name) else { return }
        compare("auditor-\(name)")
    }

    private func wait(for element: XCUIElement, _ what: String, _ name: String) -> Bool {
        if element.waitForExistence(timeout: timeout) { return true }
        XCTFail("\(name): \(what) never appeared")
        return false
    }

    /// The screen once two captures in a row are identical — no transition mid-flight.
    private func settledScreen() -> Data {
        var previous = XCUIScreen.main.screenshot().pngRepresentation
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            Thread.sleep(forTimeInterval: 0.25)
            let current = XCUIScreen.main.screenshot().pngRepresentation
            if current == previous { return current }
            previous = current
        }
        XCTFail("the screen never settled")
        return previous
    }

    private func compare(_ name: String) {
        print("ios:screenshots: \(name)")
        let actual = settledScreen()
        let reference = Self.references.appendingPathComponent("\(name).png")
        let files = FileManager.default
        if Self.record || !files.fileExists(atPath: reference.path) {
            try? files.createDirectory(at: Self.references, withIntermediateDirectories: true)
            XCTAssertNoThrow(try actual.write(to: reference), "\(name): could not record \(reference.path)")
            return
        }
        guard let expected = try? Data(contentsOf: reference),
              let result = ImageDiff.compare(expected: expected, actual: actual)
        else {
            return XCTFail("\(name): could not decode \(reference.path)")
        }
        guard result.ratio > ImageDiff.maxDiffRatio else { return }

        try? files.createDirectory(at: Self.failures, withIntermediateDirectories: true)
        let base = Self.failures.appendingPathComponent(name)
        try? actual.write(to: base.appendingPathExtension("actual.png"))
        try? result.diff?.write(to: base.appendingPathExtension("diff.png"))
        for (label, data) in [("expected", expected), ("actual", actual), ("diff", result.diff)] {
            guard let data else { continue }
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.png")
            attachment.name = "\(name)-\(label)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTFail(String(
            format: "%@: %.2f%% of pixels differ (limit %.2f%%); see %@",
            name, result.ratio * 100, ImageDiff.maxDiffRatio * 100, base.path
        ))
    }
}

/// Pixel comparison on Core Graphics — no dependency. Thresholds match the web suite.
enum ImageDiff {
    /// Share of pixels allowed to differ (Playwright's `maxDiffPixelRatio` in the web suite).
    static let maxDiffRatio = 0.002
    /// A channel must move by more than this to count; absorbs anti-aliasing noise.
    static let channelTolerance = 16

    struct Result {
        let ratio: Double
        let diff: Data?
    }

    /// `nil` when either image cannot be decoded; a size change counts as every pixel differing.
    static func compare(expected: Data, actual: Data) -> Result? {
        guard let a = rgba(expected), let b = rgba(actual) else { return nil }
        guard a.width == b.width, a.height == b.height else { return Result(ratio: 1, diff: nil) }

        var diff = [UInt8](repeating: 255, count: b.pixels.count)
        var differing = 0
        for i in stride(from: 0, to: b.pixels.count, by: 4) {
            let moved = (0..<3).contains { abs(Int(a.pixels[i + $0]) - Int(b.pixels[i + $0])) > channelTolerance }
            if moved {
                differing += 1
                (diff[i], diff[i + 1], diff[i + 2]) = (255, 0, 0)
            } else {
                // The actual image, faded, so the red stands out.
                for c in 0..<3 { diff[i + c] = UInt8(155 + Int(b.pixels[i + c]) * 100 / 255) }
            }
        }
        return Result(
            ratio: Double(differing) / Double(b.width * b.height),
            diff: differing == 0 ? nil : png(diff, width: b.width, height: b.height)
        )
    }

    private static func rgba(_ data: Data) -> (width: Int, height: Int, pixels: [UInt8])? {
        guard let image = UIImage(data: data)?.cgImage else { return nil }
        let (width, height) = (image.width, image.height)
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? (width, height, pixels) : nil
    }

    private static func png(_ pixels: [UInt8], width: Int, height: Int) -> Data? {
        guard let provider = CGDataProvider(data: Data(pixels) as CFData),
              let image = CGImage(
                  width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                  bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
              )
        else { return nil }
        return UIImage(cgImage: image).pngData()
    }
}
