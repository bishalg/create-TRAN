// Verifies: REQ-PSH-012
import UIKit
import XCTest

/// The end-to-end registration a template cannot run (ADR-0046): a build signed by a team whose
/// App ID has the Push Notifications capability, with `TRAN_PUSH_ENABLED=YES`, asks APNs for a
/// token, receives a real one through `SystemPushGateway`, and registers it with a running API.
/// To run it: build with `TRAN_PUSH_ENABLED=YES DEVELOPMENT_TEAM=$TRAN_APPLE_TEAM_ID`, start the API
/// (`pnpm dev:api`), grant notifications to the app once, and delete the skip below
/// (docs/CREDENTIALS.md).
@MainActor
final class ApnsRegistrationLiveTests: XCTestCase {
    func testARealApnsTokenIsIssuedAndRegistered() async throws {
        try XCTSkipIf(true, "TODO(credentials): TRAN_PUSH_ENABLED, TRAN_APPLE_TEAM_ID - a real APNs token is issued and registered")

        // This bundle compiles the app's sources itself, so its `SystemPushGateway.shared` is not the
        // app's: installing this bundle's application delegate sends APNs' answer to it.
        let previous = UIApplication.shared.delegate
        let delegate = TranAppDelegate()
        UIApplication.shared.delegate = delegate
        defer { UIApplication.shared.delegate = previous }
        let gateway = SystemPushGateway.shared
        XCTAssertTrue(gateway.isAvailable, "build with TRAN_PUSH_ENABLED=YES")
        let permissions = SystemPermissionGateway()
        let granted = await permissions.status(of: .notifications)
        XCTAssertEqual(granted, .granted, "grant notifications to the app once, by hand")

        let delivered = expectation(description: "APNs delivers a token")
        gateway.onEvent = { if $0 == .tokenArrived { delivered.fulfill() } }
        gateway.registerForPush()
        await fulfillment(of: [delivered], timeout: 30)
        let token = try XCTUnwrap(gateway.token)
        XCTAssertTrue(token.count >= 64 && token.count % 2 == 0 && token.allSatisfy(\.isHexDigit), "APNs hex")

        let client = TranSessionClient(vault: InMemorySessionVault())
        try await client.signIn(role: .citizenVoter)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "ApnsRegistrationLiveTests"))
        defer { defaults.removePersistentDomain(forName: "ApnsRegistrationLiveTests") }
        let store = TranPushStore(defaults: defaults)
        let registration = TranPushRegistration(
            gateway: gateway, permissions: permissions, client: client, store: store)

        let action = await registration.sync()

        XCTAssertEqual(action, .register)
        XCTAssertEqual(store.lastRegistration?.token, token, "the API answered 204")
        await registration.signOut()
        await client.signOut()
    }
}
