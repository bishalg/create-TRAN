import SwiftUI

/// Voting demo — brand tokens + offline rust-core rules via UniFFI.
struct VotingHomeView: View {
    @State private var useDark = true
    @State private var ageText = "20"
    @State private var countryCode = "NP"
    @State private var resultText = "Tap Check offline"
    var onSignOut: (() -> Void)? = nil

    var body: some View {
        let background = useDark ? TranBrandTokens.Dark.background : TranBrandTokens.Light.background
        let textPrimary = useDark ? TranBrandTokens.Dark.textPrimary : TranBrandTokens.Light.textPrimary
        let canVote = useDark ? TranBrandTokens.Dark.eligibilityCanVote : TranBrandTokens.Light.eligibilityCanVote
        let cannotVote = useDark ? TranBrandTokens.Dark.eligibilityCannotVote : TranBrandTokens.Light.eligibilityCannotVote
        let primary = useDark ? TranBrandTokens.Dark.primary : TranBrandTokens.Light.primary
        let surface = useDark ? TranBrandTokens.Dark.surface : TranBrandTokens.Light.surface

        ZStack {
            background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("TRAN / iOS")
                                .font(.headline)
                                .foregroundStyle(textPrimary)
                            Text("Offline voting (UniFFI to rust-core)")
                                .font(.subheadline)
                                .foregroundStyle(textPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        if let onSignOut {
                            Button("Sign out", action: onSignOut)
                                .buttonStyle(.bordered)
                                .tint(primary)
                                .accessibilityIdentifier("sign-out-button")
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Age")
                                .font(.subheadline)
                                .foregroundStyle(textPrimary)
                            TextField("", text: $ageText, prompt: Text("Enter age").foregroundStyle(textPrimary))
                                .keyboardType(.numberPad)
                                .padding(10)
                                .background(surface)
                                .foregroundStyle(textPrimary)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .accessibilityIdentifier("age-field")
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Country")
                                .font(.subheadline)
                                .foregroundStyle(textPrimary)
                            TextField("", text: $countryCode, prompt: Text("Two letters").foregroundStyle(textPrimary))
                                .textInputAutocapitalization(.characters)
                                .padding(10)
                                .background(surface)
                                .foregroundStyle(textPrimary)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .accessibilityIdentifier("country-field")
                        }
                    }

                    Button("Check offline") {
                        checkOffline(canVote: canVote, cannotVote: cannotVote)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .tint(primary)
                    .accessibilityIdentifier("check-button")

                    Text(resultText)
                        .font(.body)
                        .foregroundStyle(textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("offline-result")
                        .accessibilityAddTraits(.updatesFrequently)

                    Button {
                        useDark.toggle()
                    } label: {
                        HStack {
                            Text("Dark theme")
                                .foregroundStyle(textPrimary)
                            Spacer()
                            Toggle("", isOn: $useDark)
                                .labelsHidden()
                                .allowsHitTesting(false)
                                .tint(primary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dark theme")
                    .accessibilityAddTraits(.isToggle)
                    .accessibilityRemoveTraits(.isButton)
                    .accessibilityValue(useDark ? "On" : "Off")
                    .accessibilityIdentifier("theme-toggle")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
        }
        .preferredColorScheme(useDark ? .dark : .light)
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
