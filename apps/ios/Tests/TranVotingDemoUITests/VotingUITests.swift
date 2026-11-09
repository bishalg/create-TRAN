// Verifies: REQ-NAT-003 REQ-NAT-005 REQ-NAT-006 REQ-NAT-010 REQ-LOAD-002 REQ-LOAD-003 REQ-LOAD-005 REQ-SCR-002
import XCTest

/// What the screen contract's verbs cannot express (docs/TESTING.md, "Hand-written suites that
/// remain"): the accessibility audit on every theme, a check the server holds open, and the copy of
/// the fallback caption. Every shared journey runs from `screens.json` in `ScreenContractUITests`.
final class VotingUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    private func launch(_ arguments: [String] = []) {
        app.launchArguments += arguments
        app.launch()
    }

    private func check(age: String, country: String) {
        let ageField = app.textFields[ScreenContract.Eligibility.ageField]
        ageField.tap()
        ageField.clearAndType(age)
        let countryField = app.textFields[ScreenContract.Eligibility.countryField]
        countryField.tap()
        countryField.clearAndType(country)
        app.buttons[ScreenContract.Eligibility.checkButton].tap()
    }

    private func copy(_ key: String) -> String { ContractStrings.resolve(key, locale: "en") }

    /// `performAccessibilityAudit` has no contract verb: labels, contrast, Dynamic Type and hit
    /// regions on every registry theme (REQ-NAT-003, REQ-NAT-005, REQ-NAT-006).
    func testAccessibilityAuditPassesAcrossThemes() throws {
        launch()
        try app.performAccessibilityAudit()
        for theme in TranTheme.allCases {
            app.buttons["\(ScreenContract.Eligibility.themePicker)-\(theme.rawValue)"].tap()
            try app.performAccessibilityAudit()
        }
    }

    /// [REQ-LOAD-002] [REQ-LOAD-003] a check that stalls (the debug transport stub never answers)
    /// shows the pending copy under the verdict, which stays as the device computed it. The verb
    /// set cannot hold a server answer open.
    func testPendingCheckKeepsTheDeviceVerdictAndSaysItIsChecking() {
        launch(["-TranApiStub", "hang"])
        check(age: "20", country: "NP")
        let verdict = copy("eligibility.result.reasonMeets")
        waitForText(app.staticTexts[ScreenContract.Eligibility.verdictSource], copy("eligibility.result.updating"))
        XCTAssertEqual(
            app.staticTexts[ScreenContract.Eligibility.offlineResult].value as? String,
            String(format: verdict, "20", "18", "NP")
        )
        XCTAssertFalse(app.descendants(matching: .any)[ScreenContract.Eligibility.toast].exists)
    }

    /// [REQ-LOAD-005] once the retries against an unreachable API are spent, the device decides
    /// and the caption says so. The scenario only requires a caption: the web's device mode never
    /// asks the server, so the fallback copy is native-only and pinned here.
    func testUnreachableApiLabelsTheVerdictAsCheckedOnTheDevice() {
        launch(["-TranApiBaseUrl", "http://127.0.0.1:1"])
        check(age: "20", country: "NP")
        waitForText(
            app.staticTexts[ScreenContract.Eligibility.verdictSource],
            copy("eligibility.result.sourceFallback")
        )
    }

    /// A labelled text (`TranText(label:)`) reads its content as its accessibility value.
    private func waitForText(_ element: XCUIElement, _ text: String, timeout: TimeInterval = 10) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", text), object: element)
        XCTAssertEqual(
            XCTWaiter().wait(for: [expectation], timeout: timeout), .completed,
            "expected \"\(text)\", got \"\(element.exists ? String(describing: element.value) : "nothing")\""
        )
    }
}

private extension XCUIElement {
    func clearAndType(_ text: String) {
        let current = (value as? String) ?? ""
        if !current.isEmpty {
            typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        if !text.isEmpty { typeText(text) }
    }
}
