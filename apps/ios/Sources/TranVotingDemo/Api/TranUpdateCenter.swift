// Verifies: REQ-VER-009 REQ-VER-010 REQ-VER-011
import Foundation
import Observation

/// What the API said about this app's version, for the whole app (spec 028). A `426` from any call
/// raises the blocking update screen (REQ-VER-009); once raised, nothing lowers it until the app is
/// updated. A nudge (`X-Tran-Update: recommended`) becomes an `offer` when the Rust `updatePrompt`
/// says so, at most once per recommended version (REQ-VER-010). Neither touches the session.
@MainActor
@Observable
final class TranUpdateCenter {
    /// The center the app's clients report to (`TranHttp.onStanding`).
    static let shared = TranUpdateCenter()

    /// Where the dismissed recommended version is kept. A preference, never a credential.
    static let dismissedKey = "TranUpdateDismissedVersion"

    /// A recommended update to offer, once.
    struct Offer: Equatable, Identifiable {
        let id = UUID()
        /// `X-Tran-Recommended-Version`, when the server named one.
        let recommendedVersion: String?
    }

    /// The API no longer serves this version: the update screen replaces everything.
    private(set) var required = false
    /// The prompt waiting to be shown, if any.
    private(set) var offer: Offer?

    @ObservationIgnored private let defaults: UserDefaults
    /// Recommended versions already offered in this run ("" for none named), so one answer is enough.
    @ObservationIgnored private var offered: Set<String> = []

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// `TranHttp`'s default `onStanding`: hops to the main actor.
    @Sendable
    nonisolated static func post(_ signal: TranStandingSignal) {
        Task { @MainActor in shared.receive(signal) }
    }

    func receive(_ signal: TranStandingSignal) {
        switch signal {
        case .upgradeRequired:
            required = true
            offer = nil
        case let .updateRecommended(version):
            guard !required, offer == nil, !offered.contains(version ?? "") else { return }
            let state = TranUpdatePromptState(
                standing: .updateRecommended,
                recommendedVersion: version,
                dismissedVersion: defaults.string(forKey: Self.dismissedKey))
            guard updatePrompt(state: state) else { return }
            offered.insert(version ?? "")
            offer = Offer(recommendedVersion: version)
        }
    }

    /// "Not now": remembered for this recommended version only ("" when none was named).
    func dismiss(_ offer: Offer) {
        defaults.set(offer.recommendedVersion ?? "", forKey: Self.dismissedKey)
        if self.offer == offer { self.offer = nil }
    }

    /// "Update": the store opens; the prompt is done for this run.
    func accept(_ offer: Offer) {
        if self.offer == offer { self.offer = nil }
    }
}

/// The store page "Update" opens (REQ-VER-011): build configuration, never code. The
/// `TRAN_IOS_STORE_URL` build setting lands in Info.plist as `TranStoreUrl`; its placeholder
/// default is `https://tran.example/ios` until the app has a store listing.
enum TranStoreLink {
    static let key = "TranStoreUrl"
    static let placeholder = URL(string: "https://tran.example/ios")!

    static func url(bundle: Bundle = .main) -> URL {
        guard let raw = bundle.object(forInfoDictionaryKey: key) as? String, !raw.hasPrefix("$("),
            let url = URL(string: raw), url.scheme != nil
        else { return placeholder }
        return url
    }
}
