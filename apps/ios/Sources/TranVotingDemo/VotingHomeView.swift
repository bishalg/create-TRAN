import SwiftUI

/// Voting demo — brand tokens + offline rust-core rules via UniFFI.
/// Copy comes from the shared dictionaries through the generated String Catalog.
struct VotingHomeView: View {
    @Binding var theme: TranTheme
    @State private var ageText = "20"
    @State private var countryCode = "NP"
    @State private var resultText = L10n.Eligibility.resultPlaceholder
    var onSignOut: (() -> Void)? = nil

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
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
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
            resultText = res.eligible
                ? L10n.Eligibility.resultReasonMeets(String(res.age), String(res.minimumAge), res.countryCode)
                : L10n.Eligibility.resultReasonBelow(String(res.age), String(res.minimumAge), res.countryCode)
        } catch {
            // Pre-validated above; the core's English detail is never shown to users.
            resultText = L10n.Errors.countryInvalid
        }
    }
}
