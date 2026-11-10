// Verifies: REQ-SCR-006 REQ-SCR-007 REQ-SCR-008
// Verifies: REQ-ACC-004 REQ-ACC-005 REQ-ACC-006
// Verifies: REQ-A11Y-003 REQ-A11Y-007 REQ-ERR-006 REQ-ERR-007 REQ-LOAD-003 REQ-LOAD-005 REQ-NAT-001 REQ-NAT-002
// Verifies: REQ-NAT-003 REQ-NAT-004 REQ-NAT-007 REQ-NAT-011 REQ-NAT-013 REQ-NAV-001 REQ-NAV-002 REQ-NAV-003
// Verifies: REQ-NAV-004 REQ-NAV-005 REQ-WEB-001 REQ-WEB-002 REQ-WEB-004 REQ-WEB-014
import XCTest

/// The iOS interpreter of the screen contract (ADR-0038): one test per scenario of `screens.json`,
/// named after it, and nothing written per scenario. Each verb of the closed set maps to one
/// XCUITest action or assertion over contract ids; copy is resolved through the app's String
/// Catalogs and sizes come from `ScreenContract.Minimums`. The `Verifies` header above lists what
/// the scenarios cite; `packages/core-ts/tests/screen-ids.test.ts` keeps it equal to the catalogue.
/// After the given state, every `When` and the last `Then`, the app's accessibility tree is
/// recorded for `pnpm screens:check` (`ConformanceManifest`, REQ-SCR-008).
final class ScreenContractUITests: XCTestCase {
    /// Test method name → its screen and scenario.
    private static var registry: [String: (screen: ContractScreen, scenario: ContractScenario)] = [:]

    /// One test per scenario, added at run time so each reports under its own name.
    override class var defaultTestSuite: XCTestSuite {
        let suite = XCTestSuite(name: NSStringFromClass(self))
        for screen in ScreenCatalogue.shared.screens {
            for scenario in screen.scenarios {
                let name = methodName(scenario.name)
                registry[name] = (screen, scenario)
                let run: @convention(block) (ScreenContractUITests) -> Void = { $0.runScenario() }
                class_addMethod(self, NSSelectorFromString(name), imp_implementationWithBlock(run), "v@:")
                suite.addTest(ScreenContractUITests(selector: NSSelectorFromString(name)))
            }
        }
        return suite
    }

    /// `An adult in Nepal is eligible` → `test_An_adult_in_Nepal_is_eligible`.
    private static func methodName(_ scenario: String) -> String {
        "test_" + String(scenario.map { $0.isLetter || $0.isNumber ? $0 : "_" })
    }

    private var screen: ContractScreen!
    private var scenario: ContractScenario!
    private var app: XCUIApplication!
    private var launched = false
    private var checkedReach = false

    // Launch preset from the givens.
    private var session = "citizen_voter"
    private var apiUnreachable = false
    private var locale = "en"
    private var theme: String?
    private var largestText = false

    override func setUpWithError() throws {
        continueAfterFailure = false
        // `-[ScreenContractUITests test_…]` → `test_…`
        let method = name.split(separator: " ").last.map { String($0.dropLast()) } ?? name
        guard let entry = Self.registry[method] else {
            XCTFail("no screen contract scenario for \(name): run `pnpm tokens:sync`")
            return
        }
        (screen, scenario) = entry
        if let reason = unsupported() { throw XCTSkip("\(scenario.name): \(reason)") }
    }

    /// What this platform cannot stage, said once per verb.
    private func unsupported() -> String? {
        let verbs = Set((scenario.given + scenario.when).map(\.verb))
        if verbs.contains("reduced_motion") {
            return "Reduce Motion cannot be switched on for one app from XCUITest on the simulator"
        }
        if !verbs.isDisjoint(with: ["go_offline", "go_online"]) {
            return "XCUITest cannot cut the simulator's network mid-scenario, and relaunching against a refused port would lose the screen's state"
        }
        if verbs.contains("api_reachable"), !Self.apiAnswers() {
            return "the scenario needs a reachable API: start it with `pnpm dev:api`"
        }
        return nil
    }

    /// Whether the app's default API (Info.plist, `http://127.0.0.1:3001`) answers its health check.
    private static func apiAnswers() -> Bool {
        guard let url = URL(string: "http://127.0.0.1:3001/api/health") else { return false }
        let done = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: url) { _, response, _ in
            ok = (response as? HTTPURLResponse)?.statusCode == 200
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 2)
        return ok
    }

    private func runScenario() {
        for step in scenario.given { given(step) }
        for step in scenario.when { when(step) }
        for step in scenario.then { then(step) }
        record("then")
    }

    private func record(_ phase: String) {
        ConformanceManifest.record(app, scenario: scenario.name, phase: phase, locale: locale)
    }

    private var driver: ContractScreenDriver {
        ContractScreenDriver(app: app, scenario: scenario, screen: screen, locale: locale)
    }

    // MARK: - Given

    private func given(_ step: ContractStep) {
        switch step.verb {
        case "session": session = step.value ?? session
        case "api_reachable": apiUnreachable = false
        case "api_unreachable": apiUnreachable = true
        case "locale": locale = step.value ?? locale
        case "theme": theme = step.value
        case "largest_text_scale": largestText = true
        default: XCTFail("\(scenario.name) › \(step.title): unknown given")
        }
    }

    /// Opens the app in the scenario's given state, before the first `When` or `Then`, so the
    /// givens can come in any order. Debug-only launch arguments set each one.
    private func launch() {
        guard !launched else { return }
        launched = true
        app = XCUIApplication()
        app.launchArguments += ["-TranSession", session]
        // The refused port fails at once; the debug ATS exception still allows loopback.
        if apiUnreachable { app.launchArguments += ["-TranApiBaseUrl", "http://127.0.0.1:1"] }
        app.launchArguments += ["-AppleLanguages", "(\(locale))", "-AppleLocale", locale]
        if let theme { app.launchArguments += ["-TranTheme", theme] }
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", ScreenContract.Minimums.largestContentSizeCategory]
        }
        app.launch()
        record("given")
    }

    // MARK: - When

    private func when(_ step: ContractStep) {
        launch()
        let driver = driver
        guard let id = step.id else {
            XCTFail("\(driver.place(step)): unknown step")
            return
        }
        let element = driver.find(id, step)
        driver.assertMinimum(element, id, step)
        driver.scrollIntoView(element)
        switch step.verb {
        case "tap":
            element.tap()
        case "type":
            // `type` replaces the field's content, as on the web.
            element.tap()
            let current = (element.value as? String) ?? ""
            if !current.isEmpty {
                element.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
            }
            element.typeText(step.text ?? "")
        case "select":
            let option = driver.option(step.option ?? "", of: id)
            let label = "\(driver.place(step, id)) › option \"\(step.option ?? "")\""
            XCTAssertTrue(option.waitForExistence(timeout: scenario.timeout), "\(label): no such option")
            driver.assertMinimum(option, touch: driver.declared(id, step).touch, label)
            option.tap()
            XCTAssertTrue(driver.eventually { option.isSelected }, "\(label): not selected after the tap")
        case "press_key":
            guard step.key == "Enter" else {
                XCTFail("\(driver.place(step, id)): only Enter has an iOS key here")
                return
            }
            element.typeText("\n")
        default:
            XCTFail("\(driver.place(step, id)): unknown when")
        }
        record(step.title)
    }

    // MARK: - Then

    private func then(_ step: ContractStep) {
        launch()
        let driver = driver
        if largestText, !checkedReach {
            checkedReach = true
            driver.assertReachable(step)
        }
        guard let id = step.id else {
            XCTFail("\(driver.place(step)): unknown step")
            return
        }
        let place = driver.place(step, id)
        switch step.verb {
        case "exists":
            let element = driver.find(id, step)
            driver.assertMinimum(element, id, step)
        case "missing":
            let query = driver.query(id, step)
            XCTAssertTrue(driver.eventually { !query.firstMatch.exists }, "\(place): still present")
        case "text_is", "announced":
            if step.verb == "announced" {
                XCTAssertEqual(driver.declared(id, step).kind, "live_region", "\(place): only a live region announces")
            }
            let expected = ContractStrings.resolve(step.key ?? "", args: step.args ?? [], locale: locale)
            let element = driver.find(id, step)
            XCTAssertTrue(
                driver.eventually { ContractScreenDriver.text(of: element) == expected },
                "\(place): reads \"\(ContractScreenDriver.text(of: element))\", expected \"\(expected)\""
            )
            driver.assertLive(element, id, step)
        case "has_focus":
            let element = driver.find(id, step)
            XCTAssertTrue(
                driver.eventually { (element.value(forKey: "hasKeyboardFocus") as? Bool) == true },
                "\(place): does not have focus"
            )
        case "count":
            let query = driver.query(id, step)
            let n = step.n ?? 0
            XCTAssertTrue(driver.eventually { query.count == n }, "\(place): \(query.count) found, expected \(n)")
        default:
            XCTFail("\(place): unknown then")
        }
    }
}
