import SwiftUI

/// Voting demo — brand tokens + offline rust-core rules via UniFFI.
/// Copy comes from the shared dictionaries through the generated String Catalog.
struct VotingHomeView: View {
    @Binding var theme: TranTheme
    @State private var ageText = "20"
    @State private var countryCode = "NP"
    @State private var resultText = L10n.Eligibility.resultPlaceholder
    @State private var apiStatus: TranApiStatus = .checking
    /// A connectivity failure shown until a call succeeds (REQ-ERR-006).
    @State private var banner: TranRequestFailure?
    @Environment(TranFeedback.self) private var feedback
    var onSignOut: (() -> Void)? = nil
    var api: TranApiClient = TranApiClient()

    var body: some View {
        TranScreen {
            ScrollView {
                TranBox(padding: .lg) {
                    TranStack(gap: .md, alignment: .leading) {
                        TranInline(gap: .md) {
                            TranStack(gap: .xs, alignment: .leading) {
                                TranText(L10n.Shell.header("iOS"), variant: .title)
                                TranText(L10n.Eligibility.subtitle, variant: .muted)
                            }
                            Spacer()
                            if let onSignOut {
                                TranButton(label: L10n.Common.signOut, variant: .secondary, size: .md) {
                                    onSignOut()
                                }
                                .accessibilityIdentifier("sign-out-button")
                            }
                        }

                        TranStack(gap: .base, alignment: .leading) {
                            TranField(
                                label: L10n.Eligibility.ageLabel,
                                hint: L10n.Eligibility.agePlaceholder,
                                text: $ageText,
                                identifier: "age-field",
                                keyboard: .numberPad
                            )
                            TranField(
                                label: L10n.Eligibility.countryLabel,
                                hint: L10n.Eligibility.countryPlaceholder,
                                text: $countryCode,
                                identifier: "country-field",
                                autocapitalization: .characters
                            )
                        }

                        TranButton(label: L10n.Eligibility.checkOffline, fullWidth: true) {
                            checkOffline()
                        }
                        .accessibilityIdentifier("check-button")

                        TranText(resultText, live: true)
                            .accessibilityIdentifier("offline-result")

                        // Theme choices come from the rust-core registry: every case renders here,
                        // with its label from the shared dictionaries (`shell.theme.<mode>`).
                        TranSegmented(
                            options: TranTheme.allCases,
                            selection: $theme,
                            label: { $0.label },
                            accessibilityLabel: L10n.Shell.themeLabel
                        )
                        .accessibilityIdentifier("theme-picker")

                        // REQ-NAT-011: the status pill mirrors the web footer; it never gates the device check.
                        TranText(statusLabel, variant: .caption, live: true)
                            .accessibilityIdentifier("api-status")
                        if let banner {
                            TranBanner(message: TranFeedback.message(banner.spec.messageKey))
                                .accessibilityIdentifier("offline-notice")
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .task {
            await refreshApiStatus()
        }
    }

    private var statusLabel: String {
        switch apiStatus {
        case .checking: return L10n.Shell.statusChecking
        case .online: return L10n.Shell.statusOnline
        case .offline: return L10n.Shell.statusOffline
        }
    }

    private func refreshApiStatus() async {
        do {
            try await api.checkHealth()
            succeeded()
        } catch {
            // A background call the user did not start: log it, never toast.
            let failure = TranRequestFailure.classify(error)
            feedback.log(failure)
            failed(failure)
        }
    }

    /// The verdict is already on screen (REQ-NAT-002); the server confirms it in the background,
    /// retrying transient failures, and the catalogue decides how the outcome is shown.
    private func confirmWithApi(age: UInt16) {
        Task {
            do {
                try await api.confirmEligibility(age: age, countryCode: countryCode)
                succeeded()
                feedback.acknowledge(.serverCheckSucceeded)
            } catch {
                let failure = TranRequestFailure.classify(error)
                feedback.report(failure)
                failed(failure)
            }
        }
    }

    private func succeeded() {
        apiStatus = .online
        banner = nil
    }

    private func failed(_ failure: TranRequestFailure) {
        apiStatus = TranApiStatus.from(failure)
        if case .banner = failure.spec.presentation { banner = failure }
    }

    private func checkOffline() {
        // Only parsing happens here; every rule (age range, country shape) is checked once, in Rust.
        guard let age = UInt16(ageText), !countryCode.isEmpty else {
            resultText = L10n.Errors.ageAndCountry
            return
        }
        do {
            let res = try evaluateVoteEligibilityOffline(
                age: age,
                birthdateIso: nil,
                countryCode: countryCode,
                referenceDateIso: TranReferenceDate.string()
            )
            resultText = res.localizedReason
            confirmWithApi(age: age)
        } catch let error as TranValidationError {
            // Map the typed Rust variant to shared copy instead of Rust prose.
            resultText = error.localizedMessage
        } catch {
            resultText = L10n.Errors.ageAndCountry
        }
    }
}
