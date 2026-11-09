import UIKit
import XCTest

/// Finds the screen contract's elements in the running app and checks what their declaration
/// promises (REQ-SCR-006, REQ-SCR-007). Elements are found by their contract id
/// (`accessibilityIdentifier`); the numbers come from the generated `ScreenContract.Minimums`.
struct ContractScreenDriver {
    let app: XCUIApplication
    let scenario: ContractScenario
    let screen: ContractScreen
    let locale: String

    private var catalogue: ScreenCatalogue { .shared }

    /// "scenario › step › element", so a failure says where it is.
    func place(_ step: ContractStep, _ id: String? = nil) -> String {
        "\(scenario.name) › \(step.title)" + (id.map { " › element \"\($0)\"" } ?? "")
    }

    func declared(_ id: String, _ step: ContractStep) -> ContractElement {
        guard let element = catalogue.element(id) else {
            XCTFail("\(place(step, id)): not an element of the screen contract")
            fatalError("unreachable: continueAfterFailure is off")
        }
        return element
    }

    // MARK: - Finding elements

    /// The state in which the app presents a system alert. SwiftUI cannot give a system alert's
    /// buttons an `accessibilityIdentifier` without XCUITest seeing each button twice (LEARNINGS,
    /// 2026-10-21), so the elements present only in this state (the confirm and cancel buttons)
    /// are found inside `app.alerts` by their contract label, resolved like any other copy. This is
    /// the one place the iOS interpreter finds an element by anything but its id.
    static let systemAlertState = "sign_out_confirm"

    /// Every match of `id`, typed by the element's kind.
    func query(_ id: String, _ step: ContractStep) -> XCUIElementQuery {
        let element = declared(id, step)
        if element.state == Self.systemAlertState {
            let title = ContractStrings.resolve(element.label, locale: locale)
            return app.alerts.buttons.matching(NSPredicate(format: "label == %@", title))
        }
        switch element.kind {
        case "field": return app.textFields.matching(identifier: id)
        case "button": return app.buttons.matching(identifier: id)
        case "text", "live_region": return app.staticTexts.matching(identifier: id)
        default: return app.descendants(matching: .any).matching(identifier: id)
        }
    }

    /// The element `id`, once it exists (within the scenario's bound).
    func find(_ id: String, _ step: ContractStep) -> XCUIElement {
        let element = query(id, step).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: scenario.timeout), "\(place(step, id)): does not exist")
        return element
    }

    /// `<control id>-<option>`, as `TranSegmented` names each option (the theme picker comment in
    /// `crates/rust-core/src/screens/catalogue.rs`).
    func option(_ option: String, of id: String) -> XCUIElement {
        app.buttons["\(id)-\(option)"]
    }

    /// What the element reads: a field's value, a labelled text's value (`TranText(label:)` names
    /// it "Result" and reads the verdict as its value), else a text's label.
    static func text(of element: XCUIElement) -> String {
        if element.elementType == .textField, let value = element.value as? String { return value }
        if let value = element.value as? String, !value.isEmpty { return value }
        return element.label
    }

    /// Polls `condition` until it holds or the scenario's bound runs out.
    func eventually(_ condition: @escaping () -> Bool) -> Bool {
        if condition() { return true }
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        return XCTWaiter().wait(for: [expectation], timeout: scenario.timeout) == .completed
    }

    // MARK: - Non-functional rules (REQ-SCR-007)

    /// A `control` or `primary` element meets the iOS minimum on both axes.
    func assertMinimum(_ element: XCUIElement, touch: String, _ where: String) {
        guard touch != "none" else { return }
        let minimum = touch == "primary" ? ScreenContract.Minimums.primaryAction : ScreenContract.Minimums.control
        // A frame is laid out in device pixels: 44 pt can come back as 43.99999 pt, so compare
        // whole pixels.
        let width = Self.pixels(element.frame.width), height = Self.pixels(element.frame.height)
        XCTAssertGreaterThanOrEqual(width, minimum, "\(`where`): \(width) pt wide, below the \(touch) minimum")
        XCTAssertGreaterThanOrEqual(height, minimum, "\(`where`): \(height) pt tall, below the \(touch) minimum")
    }

    /// `points`, rounded to the nearest whole device pixel.
    private static func pixels(_ points: CGFloat) -> CGFloat {
        let scale = max(UITraitCollection.current.displayScale, 1)  // unspecified (0) outside a view: whole points
        return (points * scale).rounded() / scale
    }

    func assertMinimum(_ element: XCUIElement, _ id: String, _ step: ContractStep) {
        assertMinimum(element, touch: declared(id, step).touch, place(step, id))
    }

    /// A `live_region` carries the trait `TranText(live: true)` gives it, `.updatesFrequently`,
    /// which makes VoiceOver announce its changes (REQ-NAT-003).
    func assertLive(_ element: XCUIElement, _ id: String, _ step: ContractStep) {
        guard declared(id, step).kind == "live_region" else { return }
        guard let traits = Self.traits(of: element) else {
            XCTFail("\(place(step, id)): the element's accessibility traits cannot be read")
            return
        }
        XCTAssertTrue(
            UIAccessibilityTraits(rawValue: traits).contains(.updatesFrequently),
            "\(place(step, id)): not a live region (no .updatesFrequently trait)"
        )
    }

    /// XCUITest has no public traits accessor; the element snapshot carries them.
    private static func traits(of element: XCUIElement) -> UInt64? {
        guard let snapshot = try? element.snapshot() as AnyObject,
              snapshot.responds(to: NSSelectorFromString("traits"))
        else { return nil }
        return (snapshot.value(forKey: "traits") as? NSNumber)?.uint64Value
    }

    /// At the largest text size every always-present element of the screen can be scrolled to,
    /// tapped and lies wholly inside the window at its full touch size; a segmented control's
    /// every option too (REQ-NAT-004, REQ-NAT-013).
    func assertReachable(_ step: ContractStep) {
        dismissKeyboard()
        let window = app.windows.firstMatch.frame
        for element in screen.elements where element.isAlways {
            let found = find(element.id, step)
            let label = place(step, element.id)
            scrollIntoView(found)
            XCTAssertTrue(
                found.isHittable,
                "\(label): not reachable at the largest text size (frame \(found.frame), visible \(visibleArea()))"
            )
            assertInside(found, window, label)
            assertMinimum(found, touch: element.touch, label)
            if element.kind == "segmented" {
                let options = found.buttons.allElementsBoundByIndex
                XCTAssertFalse(options.isEmpty, "\(label): no options")
                for option in options {
                    let optionLabel = "\(label) › option \"\(option.label)\""
                    assertInside(option, window, optionLabel)
                    assertMinimum(option, touch: element.touch, optionLabel)
                }
            }
        }
    }

    private func assertInside(_ element: XCUIElement, _ window: CGRect, _ label: String) {
        let frame = element.frame
        XCTAssertGreaterThanOrEqual(frame.minX, window.minX, "\(label): starts off screen")
        XCTAssertLessThanOrEqual(frame.maxX, window.maxX, "\(label): ends off screen at \(frame.maxX)")
    }

    /// Scrolls the screen until `element` can be tapped: down first, then back up. Steps act on an
    /// element only once it is in view, as Playwright and Compose do before an action.
    func scrollIntoView(_ element: XCUIElement) {
        let scroller = app.scrollViews.firstMatch
        guard scroller.exists else { return }
        for towardsEnd in [true, false] {
            // Until it is in view or the scroll stops moving it (that end is reached).
            for _ in 0..<40 where !inView(element) {
                let before = element.frame
                nudge(towardsEnd: towardsEnd)
                if abs(element.frame.minY - before.minY) < 1 { break }
            }
        }
    }

    /// A quarter-screen drag with no fling, so a control at the edge can stop wholly in view
    /// (a swipe overshoots it). Dragged near the trailing edge, above any keyboard, to stay off
    /// the controls.
    private func nudge(towardsEnd: Bool) {
        let area = visibleArea()
        let origin = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
        func point(_ fraction: CGFloat) -> XCUICoordinate {
            origin.withOffset(CGVector(dx: area.maxX - 8, dy: area.minY + area.height * fraction))
        }
        point(towardsEnd ? 0.75 : 0.25)
            .press(forDuration: 0.05, thenDragTo: point(0.5), withVelocity: .slow, thenHoldForDuration: 0.2)
    }

    /// Typing is over: the keyboard's avoidance shifts the screen, so the layout is checked
    /// without it. A drag on the scroll view dismisses it, as a person would.
    private func dismissKeyboard() {
        let scroller = app.scrollViews.firstMatch
        guard scroller.exists else { return }
        for _ in 0..<3 where app.keyboards.firstMatch.exists { scroller.swipeDown() }
        XCTAssertFalse(app.keyboards.firstMatch.exists, "the keyboard cannot be dismissed")
    }

    /// The window less any on-screen keyboard: what a person can see and touch.
    private func visibleArea() -> CGRect {
        var area = app.windows.firstMatch.frame
        let keyboard = app.keyboards.firstMatch
        if keyboard.exists { area.size.height = max(0, keyboard.frame.minY - area.minY) }
        return area
    }

    /// Hittable and wholly in the visible area (or filling it when taller): a sliver at the edge
    /// is hittable but a tap there can miss the control.
    private func inView(_ element: XCUIElement) -> Bool {
        guard element.isHittable else { return false }
        let area = visibleArea()
        let frame = element.frame
        if frame.height > area.height { return true }
        return frame.minY >= area.minY && frame.maxY <= area.maxY
    }
}
