// Verifies: REQ-SEC-023
import XCTest

/// The app switcher snapshot is taken while the scene is not active; a signed-in screen must be
/// covered then, and nothing else ever is (so the UI and screenshot suites see the real screens).
final class PrivacyCoverTests: XCTestCase {
    /// Every destination the Rust director can produce, from every session.
    private let destinations: [TranAppDestination] = [
        resolveDestinationOffline(role: nil),
        resolveDestinationOffline(role: .citizenVoter),
        resolveDestinationOffline(role: .electionAuditor),
        .splash,
    ]

    func testSignedInScreensAreCoveredWheneverTheSceneIsNotActive() {
        XCTAssertTrue(TranPrivacyCover.covers(sceneIsActive: false, destination: .voterDashboard))
        XCTAssertTrue(TranPrivacyCover.covers(sceneIsActive: false, destination: .auditorDashboard))
    }

    func testAnActiveSceneIsNeverCovered() {
        for destination in destinations {
            XCTAssertFalse(TranPrivacyCover.covers(sceneIsActive: true, destination: destination), "\(destination)")
        }
    }

    func testScreensWithoutUserDataAreNotCovered() {
        XCTAssertFalse(TranPrivacyCover.covers(sceneIsActive: false, destination: .splash))
        XCTAssertFalse(TranPrivacyCover.covers(sceneIsActive: false, destination: .authWelcome))
    }

    /// The coordinator draws the cover above everything, from this policy, with no text.
    func testTheCoordinatorAppliesTheCoverFromThePolicy() throws {
        let sources = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/TranVotingDemo")
        let coordinator = try String(
            contentsOf: sources.appendingPathComponent("NavigationCoordinatorView.swift"), encoding: .utf8)
        XCTAssertTrue(coordinator.contains("TranPrivacyCover.covers("))
        XCTAssertTrue(coordinator.contains("sceneIsActive: scenePhase == .active"))
        let cover = try String(contentsOf: sources.appendingPathComponent("PrivacyCoverView.swift"), encoding: .utf8)
        XCTAssertFalse(cover.contains("TranText"), "the cover shows no text")
        XCTAssertFalse(cover.contains("L10n."), "the cover shows no text")
        XCTAssertTrue(cover.contains(".accessibilityHidden(true)"))
    }
}
