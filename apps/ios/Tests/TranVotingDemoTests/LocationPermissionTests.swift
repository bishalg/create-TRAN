// Verifies: REQ-PRV-002 REQ-PRV-003 REQ-PRV-004 REQ-PRV-006
import CoreLocation
import XCTest

/// "Use my location" against the fake gateway (ADR-0043 decision 6): every step of
/// `permissionStep`, every refusal path, the fallback and the Settings note, with no system dialog.
/// The fake records each request, so "no system prompt before a tap and the priming" is a fact the
/// tests check, not a hope.
@MainActor
final class LocationPermissionTests: XCTestCase {
    /// Kathmandu, to six places: what a reading would carry, and what must reach nothing.
    private static let latitude = 27.717245
    private static let longitude = 85.323961
    private static let fix = CLLocation(latitude: latitude, longitude: longitude)

    private var gateway: FakePermissionGateway!
    private var resolver: RecordingResolver!

    override func setUp() async throws {
        try await super.setUp()
        gateway = FakePermissionGateway()
        gateway.fix = Self.fix
        resolver = RecordingResolver(answer: "np")
    }

    private func flow(_ status: TranPermissionStatus? = nil) -> TranLocationPermission {
        if let status { gateway.statuses[.locationApproximate] = status }
        return TranLocationPermission(gateway: gateway, resolver: resolver)
    }

    // MARK: - Asked only on a tap, after the priming (REQ-PRV-003)

    func testNothingIsAskedBeforeATap() {
        _ = flow()

        XCTAssertTrue(gateway.requests.isEmpty)
        XCTAssertEqual(gateway.fixesRequested, 0)
    }

    func testTheFirstTapExplainsFirstAndAsksNothing() async {
        let location = flow(.notDetermined)

        let country = await location.use()

        XCTAssertNil(country)
        XCTAssertEqual(location.phase, .priming)
        XCTAssertTrue(gateway.requests.isEmpty, "no system prompt before Continue")
        XCTAssertEqual(gateway.fixesRequested, 0)
    }

    func testNotNowChangesNothingAndIsNotARefusal() async {
        let location = flow(.notDetermined)
        _ = await location.use()

        location.notNow()

        XCTAssertEqual(location.phase, .idle)
        XCTAssertTrue(gateway.requests.isEmpty)
        XCTAssertEqual(gateway.status(of: .locationApproximate), .notDetermined, "still never asked")
        // The next tap explains again, rather than treating "Not now" as a refusal.
        _ = await location.use()
        XCTAssertEqual(location.phase, .priming)
        XCTAssertTrue(gateway.requests.isEmpty)
    }

    func testContinueShowsTheSystemPromptOnceThenFillsTheCountry() async {
        gateway.answer = .grantedApproximate
        let location = flow(.notDetermined)
        _ = await location.use()

        let country = await location.continueAfterPriming()

        XCTAssertEqual(gateway.requests, [.locationApproximate], "one system prompt, after Continue")
        XCTAssertEqual(country, "NP", "the ISO code, upper case")
        XCTAssertEqual(gateway.fixesRequested, 1, "one reading")
        XCTAssertEqual(resolver.locations.map(\.coordinate.latitude), [Self.latitude])
        XCTAssertEqual(location.phase, .idle)
    }

    func testContinueWithoutPrimingDoesNothing() async {
        let location = flow(.notDetermined)

        let country = await location.continueAfterPriming()

        XCTAssertNil(country)
        XCTAssertTrue(gateway.requests.isEmpty)
    }

    func testAGrantedPermissionGoesStraightToTheReading() async {
        for status in [TranPermissionStatus.granted, .grantedApproximate] {
            gateway = FakePermissionGateway()
            gateway.fix = Self.fix
            let location = flow(status)

            let country = await location.use()

            XCTAssertEqual(country, "NP", status.wire)
            XCTAssertTrue(gateway.requests.isEmpty, "\(status.wire): nothing to ask")
            XCTAssertEqual(location.phase, .idle, status.wire)
        }
    }

    // MARK: - Refusal leaves a working app (REQ-PRV-004)

    func testRefusingTheSystemPromptKeepsTheCountryAndShowsNoNoteYet() async {
        gateway.answer = .deniedPermanently
        let location = flow(.notDetermined)
        _ = await location.use()

        let country = await location.continueAfterPriming()

        XCTAssertNil(country, "the country stays as typed")
        XCTAssertEqual(location.phase, .idle, "no error and no nagging right after the refusal")
        XCTAssertEqual(gateway.fixesRequested, 0)
        // The next tap says once where the setting is, and never asks again.
        _ = await location.use()
        XCTAssertEqual(location.phase, .settingsOffered)
        XCTAssertEqual(gateway.requests, [.locationApproximate])
    }

    func testAPermanentRefusalOrARestrictionOffersSettingsAndNeverAsks() async {
        for status in [TranPermissionStatus.deniedPermanently, .restricted] {
            gateway = FakePermissionGateway()
            let location = flow(status)

            let country = await location.use()

            XCTAssertNil(country, status.wire)
            XCTAssertEqual(location.phase, .settingsOffered, status.wire)
            XCTAssertTrue(gateway.requests.isEmpty, "\(status.wire): never asks again")
            XCTAssertEqual(gateway.fixesRequested, 0, status.wire)
            // Tapping again keeps the one note; still no request.
            _ = await location.use()
            XCTAssertEqual(location.phase, .settingsOffered, status.wire)
            XCTAssertTrue(gateway.requests.isEmpty, status.wire)
        }
    }

    func testOpenSettingsOpensTheAppsSettingsPage() async {
        let location = flow(.deniedPermanently)
        _ = await location.use()

        location.openSettings()

        XCTAssertEqual(gateway.settingsOpened, 1)
        XCTAssertTrue(gateway.requests.isEmpty)
    }

    /// Android's "refused, can still ask" (`denied`): explain again, then ask after Continue.
    func testARefusalTheSystemCanStillAskAboutExplainsAgain() async {
        gateway.answer = .granted
        let location = flow(.denied)

        _ = await location.use()
        XCTAssertEqual(location.phase, .priming)
        XCTAssertTrue(gateway.requests.isEmpty)

        _ = await location.continueAfterPriming()
        XCTAssertEqual(gateway.requests, [.locationApproximate])
    }

    func testNoReadingFallsBack() async {
        gateway.fix = nil
        let location = flow(.grantedApproximate)

        let country = await location.use()

        XCTAssertNil(country)
        XCTAssertTrue(resolver.locations.isEmpty)
        XCTAssertEqual(location.phase, .idle)
    }

    func testNoCountryFallsBack() async {
        for answer in [nil, ""] as [String?] {
            resolver = RecordingResolver(answer: answer)
            let location = flow(.grantedApproximate)

            let country = await location.use()

            XCTAssertNil(country, "\(String(describing: answer))")
            XCTAssertEqual(location.phase, .idle)
        }
    }

    // MARK: - Least data (REQ-PRV-006)

    /// After the country is found, the coordinates are nowhere: not in the flow, not in a log or a
    /// reporter event, not in the request that confirms the verdict.
    func testTheCoordinatesAreNeverKeptLoggedOrSent() async throws {
        let feedback = TranFeedback()
        let events = FailureLog()
        feedback.writer = events.record
        let previousSink = TranReporting.sink
        let reports = ReportLog()
        TranReporting.sink = { event, detail in reports.append("\(event) \(detail ?? "")") }
        defer { TranReporting.sink = previousSink }
        let location = flow(.grantedApproximate)

        let found = await location.use()
        let country = try XCTUnwrap(found)

        // Neither the flow nor the real gateway has anywhere to keep a reading.
        XCTAssertFalse(Self.holdsALocation(location), "the flow kept the reading")
        XCTAssertFalse(Self.holdsALocation(SystemPermissionGateway()), "the gateway can keep a reading")

        // The verdict's confirmation carries the country, and nothing of the reading.
        LocationStubProtocol.reset(status: 503)
        let api = TranApiClient(
            baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: LocationStubProtocol.session(),
            includeDebugCountry: true,
            retry: TranRetry(sleep: { _ in }, random: { 0 })
        )
        do {
            try await api.confirmEligibility(age: 20, countryCode: country)
        } catch {
            feedback.report(TranRequestFailure.classify(error))
        }
        XCTAssertFalse(LocationStubProtocol.sent.isEmpty)
        let everything = LocationStubProtocol.sent + events.renderings + reports.entries
        XCTAssertTrue(LocationStubProtocol.sent.contains { $0.contains("X-Debug-Country: NP") })
        for text in everything {
            for coordinate in ["27.71", "85.32", "27,71", "85,32"] {
                XCTAssertFalse(text.contains(coordinate), "coordinates in \(text)")
            }
        }
    }

    /// Whether a stored property of `object` is a location or a coordinate (or an optional one).
    /// The gateway the flow holds is left out: the fake keeps its scripted reading by design.
    private static func holdsALocation(_ object: Any) -> Bool {
        Mirror(reflecting: object).children.contains { child in
            guard !(child.value is PermissionGateway) else { return false }
            let kept = ["CLLocation", "CLLocationCoordinate2D", "CLLocationDegrees", "Double"]
            let type = String(describing: Swift.type(of: child.value))
            return kept.contains { type == $0 || type == "Optional<\($0)>" || type == "Array<\($0)>" }
        }
    }

    // MARK: - Copy and launch presets

    func testTheCopyComesFromTheCatalogueKeys() {
        let entry = TranLocationPermission.entry
        for key in [entry.primingTitleKey, entry.primingBodyKey, entry.purposeKey, entry.settingsNoteKey] {
            XCTAssertNotNil(TranLocationPermission.localized(key), key)
        }
        XCTAssertEqual(TranLocationPermission.primingTitle, L10n.Eligibility.locationPrimingTitle)
        XCTAssertEqual(TranLocationPermission.primingBody, L10n.Eligibility.locationPrimingBody)
        XCTAssertEqual(TranLocationPermission.settingsNote, L10n.Eligibility.locationSettingsNote)
    }

    func testIOSAnswersMapToTheSharedStatuses() {
        typealias Gateway = SystemPermissionGateway
        XCTAssertEqual(Gateway.status(.notDetermined, accuracy: .reducedAccuracy), .notDetermined)
        XCTAssertEqual(Gateway.status(.restricted, accuracy: .reducedAccuracy), .restricted)
        // iOS asks once: a refusal is final.
        XCTAssertEqual(Gateway.status(.denied, accuracy: .reducedAccuracy), .deniedPermanently)
        XCTAssertEqual(Gateway.status(.authorizedWhenInUse, accuracy: .reducedAccuracy), .grantedApproximate)
        XCTAssertEqual(Gateway.status(.authorizedWhenInUse, accuracy: .fullAccuracy), .granted)
        XCTAssertEqual(Gateway.status(.authorizedAlways, accuracy: .reducedAccuracy), .grantedApproximate)
    }

    func testUITestPresetsUseTheFakeAndStageAStatus() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "LocationPermissionTests"))
        defer { defaults.removePersistentDomain(forName: "LocationPermissionTests") }

        XCTAssertTrue(TranPermissionLaunch.gateway(defaults: defaults) is SystemPermissionGateway, "no preset: iOS")

        defaults.set("citizen_voter", forKey: AuthSession.launchPresetKey)
        let plain = TranPermissionLaunch.gateway(defaults: defaults)
        XCTAssertTrue(plain is FakePermissionGateway, "a UI test preset never reaches the system prompt")
        XCTAssertEqual(plain.status(of: .locationApproximate), .notDetermined)

        defaults.set("location_approximate=denied_permanently", forKey: TranPermissionLaunch.presetKey)
        XCTAssertEqual(TranPermissionLaunch.gateway(defaults: defaults).status(of: .locationApproximate), .deniedPermanently)

        XCTAssertEqual(TranPermissionLaunch.statuses("camera=granted, location_approximate = restricted"), [.locationApproximate: .restricted])
        XCTAssertEqual(TranPermissionLaunch.statuses("location_approximate=maybe"), [:])
    }
}

/// A country resolver that records what it was asked and answers as told.
private final class RecordingResolver: CountryResolver, @unchecked Sendable {
    private let lock = NSLock()
    private var asked: [CLLocation] = []
    private let answer: String?

    init(answer: String?) { self.answer = answer }

    var locations: [CLLocation] { lock.withLock { asked } }

    func countryCode(at location: CLLocation) async -> String? {
        lock.withLock { asked.append(location) }
        return answer
    }
}

/// Reporter events, written from whichever thread reports.
private final class ReportLog: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String] = []
    var entries: [String] { lock.withLock { stored } }
    func append(_ entry: String) { lock.withLock { stored.append(entry) } }
}

/// Records each request whole (URL, every header, the body) and answers with one status.
private final class LocationStubProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var status = 200
    nonisolated(unsafe) private static var recorded: [String] = []

    static var sent: [String] { lock.withLock { recorded } }

    static func reset(status: Int) {
        lock.withLock {
            Self.status = status
            recorded = []
        }
    }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LocationStubProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let headers = (request.allHTTPHeaderFields ?? [:]).sorted { $0.key < $1.key }
            .map { "\($0.key): \($0.value)" }.joined(separator: "\n")
        let body = request.streamedBody.map { String(decoding: $0, as: UTF8.self) } ?? ""
        let entry = "\(request.httpMethod ?? "GET") \(request.url?.absoluteString ?? "")\n\(headers)\n\(body)"
        let status = Self.lock.withLock { () -> Int in
            Self.recorded.append(entry)
            return Self.status
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
