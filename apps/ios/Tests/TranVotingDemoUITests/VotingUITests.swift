// Verifies: REQ-NAT-002 REQ-NAT-003 REQ-NAT-004 REQ-NAT-005 REQ-NAT-006
import XCTest

/// Native UI + accessibility tests. Journeys mirror e2e/maestro/flows and e2e/features.
final class VotingUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
    }

    private func check(age: String, country: String) {
        let ageField = app.textFields["age-field"]
        ageField.tap()
        ageField.clearAndType(age)
        let countryField = app.textFields["country-field"]
        countryField.tap()
        countryField.clearAndType(country)
        app.buttons["check-button"].tap()
    }

    func testAdultInNepalIsEligible() {
        check(age: "20", country: "NP")
        XCTAssertEqual(
            app.staticTexts["offline-result"].label,
            "Age 20 meets the minimum voting age of 18 in NP."
        )
    }

    func testSixteenIsEligibleInBrazilButNotInTheUS() {
        check(age: "16", country: "BR")
        XCTAssertEqual(
            app.staticTexts["offline-result"].label,
            "Age 16 meets the minimum voting age of 16 in BR."
        )
        check(age: "16", country: "US")
        XCTAssertEqual(
            app.staticTexts["offline-result"].label,
            "Age 16 is below the minimum voting age of 18 in US."
        )
    }

    func testInvalidAgeIsExplained() {
        check(age: "", country: "NP")
        XCTAssertEqual(app.staticTexts["offline-result"].label, "Enter age and country")
    }

    func testControlsAreAtLeast44PointsAndLabelled() {
        let check = app.descendants(matching: .any)["check-button"]
        XCTAssertGreaterThanOrEqual(check.frame.height, 44, "check-button is too short to tap")
        let themeRow = app.descendants(matching: .any).matching(identifier: "theme-toggle").element(boundBy: 0)
        XCTAssertTrue(themeRow.waitForExistence(timeout: 2))
        XCTAssertGreaterThanOrEqual(themeRow.frame.height, 44, "theme-toggle is too short to tap")
        XCTAssertTrue(app.buttons["Check offline"].exists, "button needs a spoken label")
        XCTAssertTrue(themeRow.label.contains("Dark theme"), "toggle needs a spoken label")
    }

    func testAccessibilityAuditPassesInBothThemes() throws {
        try app.performAccessibilityAudit()
        app.descendants(matching: .any)["theme-toggle"].tap()
        try app.performAccessibilityAudit()
    }

    func testLargestDynamicTypeKeepsResultReachable() throws {
        app.terminate()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        check(age: "20", country: "NP")
        XCTAssertTrue(app.staticTexts["offline-result"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["offline-result"].label.contains("minimum voting age"))
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
