import Foundation
import XCTest

/// The iOS half of the conformance manifest (ADR-0038 decision 6, REQ-SCR-008): after a scenario's
/// given state, each `When` and its last `Then`, `ScreenContractUITests` records what the app
/// exposes to VoiceOver, and `pnpm screens:check` compares it with the contract.
///
/// The simulator shares the Mac's file system, so the test process writes `e2e/conformance/ios.json`
/// in this checkout directly, found from this source file's path (`e2e/conformance/README.md`).
/// The whole manifest is rewritten after every snapshot, so an interrupted run still leaves one.
enum ConformanceManifest {
    /// `<repo>/apps/ios/Tests/TranVotingDemoUITests/ConformanceManifest.swift` → `<repo>/e2e/conformance/ios.json`.
    static let file: URL = {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        return root.appendingPathComponent("e2e/conformance/ios.json")
    }()

    private static var snapshots: [[String: Any]] = []

    /// Records the app's tree after `phase`, once it has settled (an alert or a transition is still
    /// animating in right after a tap), unless it is what this scenario recorded last.
    static func record(_ app: XCUIApplication, scenario: String, phase: String, locale: String) {
        guard var elements = capture(app, locale: locale) else {
            XCTFail("\(scenario) › \(phase): the accessibility tree cannot be read")
            return
        }
        for _ in 0..<12 {
            Thread.sleep(forTimeInterval: 0.25)
            guard let next = capture(app, locale: locale) else { break }
            if NSArray(array: next).isEqual(to: elements) { break }
            elements = next
        }
        if let last = snapshots.last, last["scenario"] as? String == scenario,
           NSArray(array: last["elements"] as? [[String: Any]] ?? []).isEqual(to: elements) {
            return
        }
        snapshots.append([
            "platform": "ios", "scenario": scenario, "phase": phase, "locale": locale, "elements": elements,
        ])
        write()
    }

    private static func capture(_ app: XCUIApplication, locale: String) -> [[String: Any]]? {
        guard let root = try? app.snapshot() else { return nil }
        var elements: [[String: Any]] = []
        collect(root, within: nil, under: [], locale: locale, into: &elements)
        return elements
    }

    private static func write() {
        let manifest: [String: Any] = ["platform": "ios", "snapshots": snapshots]
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: file)
        } catch {
            XCTFail("cannot write the conformance manifest to \(file.path): \(error)")
        }
    }

    /// Element types that take a tap or text input.
    private static let interactive: Set<XCUIElement.ElementType> = [
        .button, .textField, .secureTextField, .searchField, .textView, .switch, .toggle, .slider,
        .stepper, .link, .picker, .pickerWheel, .key, .menuItem, .tab, .radioButton, .checkBox,
        .popUpButton, .comboBox, .menuButton, .incrementArrow, .decrementArrow, .cell,
    ]

    /// The alert's buttons are the one element iOS cannot identify (`ContractScreenDriver`, the
    /// system alert state): they take the contract id whose label they read, as the driver finds them.
    private static func alertButtonId(_ label: String, locale: String) -> String? {
        ScreenCatalogue.shared.screens.lazy.flatMap(\.elements)
            .first { $0.state == ContractScreenDriver.systemAlertState && ContractStrings.resolve($0.label, locale: locale) == label }?
            .id
    }

    private static func collect(
        _ node: XCUIElementSnapshot, within: String?, under: [String], locale: String, into elements: inout [[String: Any]]
    ) {
        let role = name(of: node.elementType)
        var id = node.identifier.isEmpty ? nil : node.identifier
        var matched: String?
        if id == nil, node.elementType == .button, under.contains("alert"), let byLabel = alertButtonId(node.label, locale: locale) {
            id = byLabel
            matched = "label"
        }
        let isInteractive = interactive.contains(node.elementType)
        if id != nil || isInteractive {
            var element: [String: Any] = [
                "role": role,
                "name": node.label,
                "interactive": isInteractive,
                "frame": ["x": node.frame.minX, "y": node.frame.minY, "width": node.frame.width, "height": node.frame.height],
                "unit": "pt",
            ]
            if let id { element["id"] = id }
            if let matched { element["matched"] = matched }
            if let value = node.value as? String, !value.isEmpty, value != node.label { element["value"] = value }
            if let within { element["within"] = within }
            if !under.isEmpty { element["under"] = Array(Set(under)).sorted() }
            elements.append(element)
        }
        let containers = [XCUIElement.ElementType.keyboard, .alert, .navigationBar, .statusBar, .sheet]
        let nextUnder = containers.contains(node.elementType) ? under + [role] : under
        for child in node.children {
            collect(child, within: id ?? within, under: nextUnder, locale: locale, into: &elements)
        }
    }

    /// The `XCUIElement.ElementType` case name.
    private static func name(of type: XCUIElement.ElementType) -> String {
        switch type {
        case .application: "application"
        case .window: "window"
        case .alert: "alert"
        case .sheet: "sheet"
        case .button: "button"
        case .staticText: "staticText"
        case .textField: "textField"
        case .secureTextField: "secureTextField"
        case .searchField: "searchField"
        case .textView: "textView"
        case .segmentedControl: "segmentedControl"
        case .switch: "switch"
        case .toggle: "toggle"
        case .slider: "slider"
        case .stepper: "stepper"
        case .link: "link"
        case .image: "image"
        case .progressIndicator: "progressIndicator"
        case .activityIndicator: "activityIndicator"
        case .scrollView: "scrollView"
        case .keyboard: "keyboard"
        case .key: "key"
        case .navigationBar: "navigationBar"
        case .statusBar: "statusBar"
        case .cell: "cell"
        case .picker: "picker"
        case .pickerWheel: "pickerWheel"
        case .menuItem: "menuItem"
        case .tab: "tab"
        case .radioButton: "radioButton"
        case .checkBox: "checkBox"
        case .group: "group"
        case .other: "other"
        default: "type\(type.rawValue)"
        }
    }
}
