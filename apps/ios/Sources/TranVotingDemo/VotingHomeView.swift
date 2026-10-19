import SwiftUI

/// Voting demo — brand tokens + offline rust-core rules via UniFFI.
struct VotingHomeView: View {
    let palette: TranPalette
    @Binding var theme: TranTheme
    @State private var ageText = "20"
    @State private var countryCode = "NP"
    @State private var resultText = "Tap Check offline"
    var onSignOut: (() -> Void)? = nil

    var body: some View {
        ZStack {
            palette.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("TRAN / iOS")
                                .font(.headline)
                                .foregroundStyle(palette.textPrimary)
                            Text("Offline voting (UniFFI to rust-core)")
                                .font(.subheadline)
                                .foregroundStyle(palette.textPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        if let onSignOut {
                            Button("Sign out", action: onSignOut)
                                .buttonStyle(.bordered)
                                .tint(palette.primary)
                                .accessibilityIdentifier("sign-out-button")
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Age")
                                .font(.subheadline)
                                .foregroundStyle(palette.textPrimary)
                            TextField("", text: $ageText, prompt: Text("Enter age").foregroundStyle(palette.textPrimary))
                                .keyboardType(.numberPad)
                                .padding(10)
                                .background(palette.surface)
                                .foregroundStyle(palette.textPrimary)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .accessibilityIdentifier("age-field")
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Country")
                                .font(.subheadline)
                                .foregroundStyle(palette.textPrimary)
                            TextField("", text: $countryCode, prompt: Text("Two letters").foregroundStyle(palette.textPrimary))
                                .textInputAutocapitalization(.characters)
                                .padding(10)
                                .background(palette.surface)
                                .foregroundStyle(palette.textPrimary)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .accessibilityIdentifier("country-field")
                        }
                    }

                    Button("Check offline") {
                        checkOffline(
                            canVote: palette.eligibilityCanVote,
                            cannotVote: palette.eligibilityCannotVote
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .tint(palette.primary)
                    .accessibilityIdentifier("check-button")

                    Text(resultText)
                        .font(.body)
                        .foregroundStyle(palette.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("offline-result")
                        .accessibilityAddTraits(.updatesFrequently)

                    // Theme choices come from the rust-core registry: every case renders here,
                    // so adding a palette in tokens.rs surfaces via `pnpm tokens:sync`.
                    Picker("Theme", selection: $theme) {
                        ForEach(TranTheme.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .accessibilityIdentifier("theme-picker")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
        }
    }

    private func checkOffline(canVote: Color, cannotVote: Color) {
        guard let age = UInt16(ageText), !countryCode.isEmpty else {
            resultText = "Enter age and country"
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
            let tint = res.eligible ? canVote : cannotVote
            resultText = res.reason
            _ = tint
        } catch let err as TranValidationError {
            if case .ValidationError(let detail) = err {
                resultText = detail
            } else {
                resultText = String(describing: err)
            }
        } catch {
            resultText = error.localizedDescription
        }
    }
}
