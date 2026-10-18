# Testing & Quality Gates Guide

This guide establishes the testing standards and automated quality gates for production iOS engineering, drawing on patterns from **Bitwarden (`GlobalTestHelpers`)**, **Point-Free (`SyncUps`)**, and **Element X (`PreviewTests`)**.

---

## 1. Modern Testing with Swift Testing

Target the Swift Testing framework (`import Testing`) for all new test suites. It provides structured test discovery, parameterized tests, and clear diagnostic expressions (`#expect`).

```swift
import Testing
@testable import TranVotingDemo

@Suite("Voting Eligibility Parity Tests")
struct VotingEligibilityTests {

    @Test("Valid age and country evaluates to eligible", arguments: [
        (UInt16(18), "NP", true),
        (UInt16(21), "US", true),
        (UInt16(16), "NP", false)
    ])
    func testEligibilityEvaluation(age: UInt16, country: String, expectedEligible: Bool) throws {
        let engine = LocalVotingEngine()
        let result = try engine.evaluate(age: age, country: country)
        #expect(result.eligible == expectedEligible)
    }

    @Test("Throws validation error on blank country code")
    func testBlankCountryCodeThrows() {
        let engine = LocalVotingEngine()
        #expect(throws: VotingError.invalidCountry) {
            try engine.evaluate(age: 20, country: "")
        }
    }
}
```

---

## 2. Cross-Platform Fixture Parity Testing

In cross-platform architectures (Rust core + UniFFI + Swift + Kotlin), business rules are validated against shared JSON fixtures (e.g. `fixtures/vote-eligibility.json`):

```swift
import Testing
import Foundation
@testable import TranVotingDemo

struct ParityFixture: Decodable {
    let age: UInt16
    let countryCode: String
    let expectedEligible: Bool
    let expectedReason: String
}

@Test("Validates parity against golden fixtures")
func testGoldenParity() throws {
    guard let fixtureUrl = Bundle.module.url(forResource: "vote-eligibility", withExtension: "json") else {
        Issue.record("Missing vote-eligibility.json fixture")
        return
    }
    let data = try Data(contentsOf: fixtureUrl)
    let fixtures = try JSONDecoder().decode([ParityFixture].self, from: data)

    for item in fixtures {
        let result = try evaluateVoteEligibilityOffline(
            age: item.age,
            birthdateIso: nil,
            countryCode: item.countryCode,
            referenceDateIso: "2026-10-18"
        )
        #expect(result.eligible == item.expectedEligible)
        #expect(result.reason == item.expectedReason)
    }
}
```

---

## 3. Controlled Dependency Testing

Never let unit tests call live network endpoints, read unseeded system clocks, or access live Keychains. Inject deterministic dependencies:

```swift
@Test("AccountViewModel handles network failure gracefully")
@MainActor
func testViewModelFailureState() async {
    let mockClient = MockAPIClient(shouldFail: true)
    let viewModel = AccountViewModel(client: mockClient)

    #expect(viewModel.state == .notRequested)
    await viewModel.fetchAccount(id: "123")

    guard case .failed = viewModel.state else {
        Issue.record("Expected .failed state, got \(viewModel.state)")
        return
    }
}
```

---

## 4. SwiftLint & SwiftFormat Quality Gates

Adopt enterprise linting rules inspired by **Proton Pass (`.swiftlint.yml`)**:

```yaml
# .swiftlint.yml
disabled_rules:
  - trailing_whitespace
opt_in_rules:
  - empty_count
  - fatal_error_message
  - force_unwrapping
  - implicitly_unwrapped_optional
  - overridden_super_call
  - redundant_nil_coalescing
  - strict_fileprivate
  - unneeded_parentheses_in_closure_argument
  - vertical_whitespace_closing_braces

line_length:
  warning: 800
  error: 1000

file_length:
  warning: 800
  error: 1000

cyclomatic_complexity:
  warning: 10
  error: 20

type_body_length:
  warning: 400
  error: 600

function_body_length:
  warning: 60
  error: 100
```

---

## 5. XcodeGen `project.yml` Best Practices

Define Xcode projects declaratively via `project.yml` (e.g. `apps/ios/project.yml`) to eliminate git merge conflicts in `.pbxproj` files:

```yaml
name: TranVotingDemo
options:
  bundleIdPrefix: org.tran
  xcodeVersion: '16.0'
settings:
  SWIFT_VERSION: '6.0'
  SWIFT_STRICT_CONCURRENCY: complete
  SWIFT_TREAT_WARNINGS_AS_ERRORS: YES
  ENABLE_USER_SCRIPT_SANDBOXING: YES
targets:
  TranVotingDemo:
    type: application
    platform: iOS
    deploymentTarget: '17.0'
    sources:
      - path: Sources/TranVotingDemo
  TranVotingDemoTests:
    type: bundle.unit-test
    platform: iOS
    sources:
      - path: Tests/TranVotingDemoTests
    dependencies:
      - target: TranVotingDemo
```
