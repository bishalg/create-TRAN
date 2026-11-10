// Verifies: REQ-PRV-003 REQ-PRV-006
import CoreLocation
import UIKit

/// The one type that asks iOS for a permission or a location (REQ-PRV-003):
/// `permission-declarations.test.ts` fails when any other source file touches the location
/// manager or an authorization request. Location is while-in-use and reduced accuracy only
/// (`NSLocationDefaultAccuracyReduced` in `project.yml`; temporary full accuracy is never asked
/// for), and one reading at a time (REQ-PRV-006). Delegate callbacks arrive on the main thread,
/// where the manager is created.
@MainActor
final class SystemPermissionGateway: NSObject, PermissionGateway {
    /// Created on first use (a tap), never at launch.
    private lazy var manager: CLLocationManager = {
        let manager = CLLocationManager()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyReduced
        return manager
    }()

    private var authorizationWaiters: [CheckedContinuation<TranPermissionStatus, Never>] = []
    private var fixWaiters: [CheckedContinuation<CLLocation?, Never>] = []

    func status(of permission: TranPermissionId) -> TranPermissionStatus {
        switch permission {
        case .locationApproximate:
            return Self.status(manager.authorizationStatus, accuracy: manager.accuracyAuthorization)
        }
    }

    func request(_ permission: TranPermissionId) async -> TranPermissionStatus {
        let current = status(of: permission)
        // iOS shows its prompt once; any other state is already the answer.
        guard current == .notDetermined else { return current }
        return await withCheckedContinuation { waiter in
            authorizationWaiters.append(waiter)
            if authorizationWaiters.count == 1 { manager.requestWhenInUseAuthorization() }
        }
    }

    func oneApproximateFix() async -> CLLocation? {
        switch status(of: .locationApproximate) {
        case .granted, .grantedApproximate: break
        default: return nil
        }
        return await withCheckedContinuation { waiter in
            fixWaiters.append(waiter)
            // One reading, then the manager stops by itself: no updates stream.
            if fixWaiters.count == 1 { manager.requestLocation() }
        }
    }

    func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    /// iOS's answer in the shared vocabulary. iOS asks once, so a refusal is permanent: only
    /// Settings can change it (`denied_permanently`, never `denied`).
    nonisolated static func status(
        _ authorization: CLAuthorizationStatus, accuracy: CLAccuracyAuthorization
    ) -> TranPermissionStatus {
        switch authorization {
        case .notDetermined: return .notDetermined
        case .restricted: return .restricted
        case .denied: return .deniedPermanently
        case .authorizedWhenInUse, .authorizedAlways:
            return accuracy == .reducedAccuracy ? .grantedApproximate : .granted
        @unknown default: return .restricted
        }
    }

    // MARK: - Delegate answers

    fileprivate func authorizationChanged() {
        let answer = status(of: .locationApproximate)
        // The delegate also reports the starting state; only an answer ends the wait.
        guard answer != .notDetermined else { return }
        let waiters = authorizationWaiters
        authorizationWaiters = []
        waiters.forEach { $0.resume(returning: answer) }
    }

    fileprivate func fixArrived(_ fix: CLLocation?) {
        let waiters = fixWaiters
        fixWaiters = []
        waiters.forEach { $0.resume(returning: fix) }
    }
}

extension SystemPermissionGateway: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated { authorizationChanged() }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let fix = locations.last
        MainActor.assumeIsolated { fixArrived(fix) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // No reading: the feature falls back, and the error (which carries no coordinates) is not
        // the person's problem to hear about (REQ-PRV-004).
        MainActor.assumeIsolated { fixArrived(nil) }
    }
}
