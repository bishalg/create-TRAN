import Foundation
import XCTest

/// `screens.json`, the scenario catalogue `pnpm tokens:sync` writes from the Rust screen contract
/// (ADR-0038). The shape is documented at the top of `crates/tran-tokens-codegen/src/screens_json.rs`:
/// every step is one flat object with a `verb` and only the fields that verb uses.
struct ScreenCatalogue: Decodable {
    let scenarioBoundMs: Int
    let screens: [ContractScreen]

    enum CodingKeys: String, CodingKey {
        case scenarioBoundMs = "scenario_bound_ms"
        case screens
    }

    /// Loaded once from the UI-test bundle, where `Resources/screens.json` is copied.
    static let shared: ScreenCatalogue = {
        let bundle = Bundle(for: ScreenContractUITests.self)
        guard let url = bundle.url(forResource: "screens", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalogue = try? JSONDecoder().decode(ScreenCatalogue.self, from: data)
        else {
            fatalError("screens.json is missing from the UI-test bundle or does not decode: run `pnpm tokens:sync`")
        }
        return catalogue
    }()

    /// The declaration of `id`, wherever it is listed: a shared element is declared once.
    func element(_ id: String) -> ContractElement? {
        screens.lazy.flatMap(\.elements).first { $0.id == id }
    }
}

struct ContractScreen: Decodable {
    let id: String
    let destination: String
    let intent: String
    let elements: [ContractElement]
    let scenarios: [ContractScenario]
}

struct ContractElement: Decodable {
    let id: String
    let kind: String
    let label: String
    let touch: String
    let presence: String
    let state: String?

    var isAlways: Bool { presence == "always" }
}

struct ContractScenario: Decodable {
    let name: String
    let verifies: [String]
    let withinMs: Int
    let given: [ContractStep]
    let when: [ContractStep]
    let then: [ContractStep]

    enum CodingKeys: String, CodingKey {
        case name, verifies, given, when, then
        case withinMs = "within_ms"
    }

    /// Every `Then` waits at most this long (REQ-SCR-004).
    var timeout: TimeInterval { TimeInterval(withinMs) / 1000 }
}

struct ContractArg: Decodable {
    let name: String
    let value: String
}

struct ContractStep: Decodable {
    let verb: String
    let value: String?
    let id: String?
    let text: String?
    let option: String?
    let key: String?
    let args: [ContractArg]?
    let n: Int?

    /// How a failure names the step: the verb and its operands, as the Gherkin quotes them.
    var title: String {
        [verb, id, text, option, key, value, n.map(String.init)]
            .compactMap { $0 }
            .joined(separator: " ")
    }
}

/// Resolves a locale key through the app's own generated String Catalogs
/// (`Sources/TranVotingDemo/Generated/Strings/*.xcstrings`, compiled into this bundle too), never
/// through copy written here (REQ-I18N, REQ-SCR-006). A key's table is its module, the first
/// segment: `eligibility.result.reasonMeets` lives in `Eligibility`. Arguments are positional, in
/// the order the template names them first; `rust-core` tests that `screens.json` lists them so.
enum ContractStrings {
    static func resolve(_ key: String, args: [ContractArg] = [], locale: String) -> String {
        let bundle = Bundle(for: ScreenContractUITests.self)
        let localized = bundle.path(forResource: locale, ofType: "lproj").flatMap(Bundle.init(path:))
        guard let module = key.split(separator: ".").first, let table = localized else {
            XCTFail("no \(locale) strings for \"\(key)\" in the UI-test bundle")
            return key
        }
        let template = table.localizedString(forKey: key, value: nil, table: module.prefix(1).uppercased() + module.dropFirst())
        if template == key { XCTFail("\"\(key)\" is not in the \(locale) String Catalog") }
        return args.isEmpty ? template : String(format: template, arguments: args.map(\.value))
    }
}
