// Verifies: REQ-NAT-002 REQ-NAT-003 REQ-NAT-004 REQ-NAT-005 REQ-NAT-006 REQ-NAT-007 REQ-NAT-010
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
        XCTAssertTrue(check.isHittable, "check-button must be tappable")
        XCTAssertTrue(app.buttons["Check offline"].exists, "button needs a spoken label")

        // The theme picker is app-owned (TranSegmented), so every segment is a ≥44×44 pt target.
        let themePicker = app.descendants(matching: .any).matching(identifier: "theme-picker").element(boundBy: 0)
        XCTAssertTrue(themePicker.waitForExistence(timeout: 2))
        XCTAssertTrue(themePicker.isHittable, "theme-picker must be tappable")
        for name in ["Light", "Dark", "Black", "Sepia"] {
            let segment = app.buttons[name]
            XCTAssertTrue(segment.exists, "\(name) needs a spoken label")
            XCTAssertGreaterThanOrEqual(segment.frame.height, 44, "\(name) segment is too short to tap")
            XCTAssertGreaterThanOrEqual(segment.frame.width, 44, "\(name) segment is too narrow to tap")
        }
    }

    func testAccessibilityAuditPassesAcrossThemes() throws {
        try app.performAccessibilityAudit()
        for name in ["Light", "Dark", "Black", "Sepia"] {
            app.buttons[name].tap()
            try app.performAccessibilityAudit()
        }
    }

    func testEveryRegistryThemeIsSelectable() {
        for name in ["Light", "Dark", "Black", "Sepia"] {
            let segment = app.buttons[name]
            XCTAssertTrue(segment.waitForExistence(timeout: 2), "\(name) must be in the registry picker")
            segment.tap()
            XCTAssertTrue(segment.isSelected, "\(name) must apply once selected")
            XCTAssertTrue(app.buttons["check-button"].exists, "\(name) must keep the dashboard usable")
        }
    }

    func testLargestDynamicTypeKeepsResultReachable() throws {
        check(age: "20", country: "NP")
        let defaultHeight = app.staticTexts["offline-result"].frame.height

        app.terminate()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()

        check(age: "20", country: "NP")
        let result = app.staticTexts["offline-result"]
        XCTAssertTrue(result.waitForExistence(timeout: 2))
        XCTAssertTrue(result.label.contains("minimum voting age"))
        XCTAssertGreaterThan(result.frame.height, defaultHeight, "the accessibility content size category was not applied")
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
