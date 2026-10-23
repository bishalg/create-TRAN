// Verifies: REQ-ERR-007 REQ-NAT-002 REQ-NAT-003 REQ-NAT-004 REQ-NAT-005 REQ-NAT-006 REQ-NAT-007 REQ-NAT-010 REQ-NAT-011
// Verifies: REQ-LOAD-002 REQ-LOAD-003 REQ-LOAD-005 REQ-NAT-013
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

    func testDeviceVerdictSurvivesAnUnreachableApi() {
        // The launch argument points the client at a refused port; the debug ATS exception still
        // applies, so only the reachability check fails (REQ-NAT-011).
        app.terminate()
        app.launchArguments += ["-TranApiBaseUrl", "http://127.0.0.1:1"]
        app.launch()

        let status = app.staticTexts["api-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertEqual(status.label, "API offline")
        // A banner, not an error toast: the catalogue presents `network.offline` persistently.
        XCTAssertTrue(app.descendants(matching: .any)["offline-notice"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["toast"].exists)

        // REQ-NAT-002: the verdict does not wait for the API.
        check(age: "20", country: "NP")
        XCTAssertEqual(
            app.staticTexts["offline-result"].label,
            "Age 20 meets the minimum voting age of 18 in NP."
        )

        // [REQ-LOAD-005] once the retries are spent the device decides, and the result says so.
        waitForLabel(
            app.staticTexts["verdict-source"],
            "The server could not answer — checked on this device."
        )
        // [REQ-LOAD-003] the verdict itself is untouched by the server's silence.
        XCTAssertEqual(
            app.staticTexts["offline-result"].label,
            "Age 20 meets the minimum voting age of 18 in NP."
        )
    }

    func testPendingCheckKeepsTheDeviceVerdictAndSaysItIsChecking() {
        // [REQ-LOAD-002] [REQ-LOAD-003] a check that stalls (the debug transport stub never answers)
        // shows the pending copy under the verdict, which stays as the device computed it.
        app.terminate()
        app.launchArguments += ["-TranApiStub", "hang"]
        app.launch()

        check(age: "20", country: "NP")
        waitForLabel(app.staticTexts["verdict-source"], "Checking with the server…")
        XCTAssertEqual(
            app.staticTexts["offline-result"].label,
            "Age 20 meets the minimum voting age of 18 in NP."
        )
        XCTAssertFalse(app.descendants(matching: .any)["toast"].exists)
    }

    private func waitForLabel(_ element: XCUIElement, _ label: String, timeout: TimeInterval = 10) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", label), object: element)
        XCTAssertEqual(
            XCTWaiter().wait(for: [expectation], timeout: timeout), .completed,
            "expected \"\(label)\", got \"\(element.exists ? element.label : "nothing")\""
        )
    }

    func testSignOutAsksFirstAndCancelKeepsTheSession() {
        app.buttons["sign-out-button"].tap()
        let dialog = app.alerts["Sign out?"]
        XCTAssertTrue(dialog.waitForExistence(timeout: 2))
        dialog.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["check-button"].waitForExistence(timeout: 2))

        app.buttons["sign-out-button"].tap()
        app.alerts["Sign out?"].buttons["Sign out"].tap()
        XCTAssertTrue(app.buttons["Continue as Citizen Voter"].waitForExistence(timeout: 2))
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

    /// The largest text size is the narrowest a screen gets: sign out and every theme keep a full-size target
    /// inside the window (REQ-NAT-013).
    func testLargestDynamicTypeKeepsSignOutAndEveryThemeOnScreen() throws {
        app.terminate()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()

        let window = app.windows.element(boundBy: 0).frame
        let signOut = app.buttons["sign-out-button"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 2))
        XCTAssertTrue(signOut.isHittable, "sign out must be tappable")
        assertWhollyInside(signOut, window, name: "sign out")
        for name in ["Light", "Dark", "Black", "Sepia"] {
            assertWhollyInside(app.buttons[name], window, name: "theme \(name)")
        }
    }

    private func assertWhollyInside(_ element: XCUIElement, _ window: CGRect, name: String) {
        XCTAssertTrue(element.exists, "\(name) must exist")
        let frame = element.frame
        XCTAssertGreaterThanOrEqual(frame.width, 44, "\(name) is \(frame.width) pt wide")
        XCTAssertGreaterThanOrEqual(frame.minX, window.minX, "\(name) starts off screen")
        XCTAssertLessThanOrEqual(frame.maxX, window.maxX, "\(name) ends off screen at \(frame.maxX)")
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
