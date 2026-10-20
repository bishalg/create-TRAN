import SwiftUI

/// Voting demo — brand tokens + offline rust-core rules via UniFFI.
/// Copy comes from the shared dictionaries through the generated String Catalog.
struct VotingHomeView: View {
    @Binding var theme: TranTheme
    @State private var ageText = "20"
    @State private var countryCode = "NP"
    @State private var resultText = L10n.Eligibility.resultPlaceholder
    @State private var apiStatus: TranApiStatus = .checking
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
                        if apiStatus == .offline {
                            TranText(L10n.Eligibility.offlineNotice, variant: .caption)
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
            apiStatus = .online
        } catch {
            apiStatus = TranApiStatus.from(error)
        }
    }

    /// The verdict is already on screen; the API call only moves the status pill (REQ-NAT-011).
    private func confirmWithApi(age: UInt16) {
        Task {
            do {
                try await api.confirmEligibility(age: age, countryCode: countryCode)
                apiStatus = .online
            } catch {
                apiStatus = TranApiStatus.from(error)
            }
        }
    }

    private func checkOffline() {
        guard let age = UInt16(ageText), !countryCode.isEmpty else {
            resultText = L10n.Errors.ageAndCountry
            return
        }
        guard age <= 150 else {
            resultText = L10n.Errors.ageOutOfRange
            return
        }
        guard countryCode.count == 2, countryCode.allSatisfy({ $0.isLetter }) else {
            resultText = L10n.Errors.countryInvalid
            return
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        let reference = formatter.string(from: Date())
        do {
            let res = try evaluateVoteEligibilityOffline(
                age: age,
                birthdateIso: nil,
                countryCode: countryCode,
                referenceDateIso: String(reference)
            )
            resultText = res.localizedReason
            confirmWithApi(age: age)
        } catch let error as TranValidationError {
            // Pre-validated above; map the typed variant to shared copy instead of Rust prose.
            resultText = error.localizedMessage
        } catch {
            resultText = L10n.Errors.ageAndCountry
        }
    }
}
