import SwiftUI

/// Voting demo — brand tokens + offline rust-core rules via UniFFI.
struct VotingHomeView: View {
    @State private var useDark = true
    @State private var ageText = "20"
    @State private var countryCode = "NP"
    @State private var resultText = "Tap Check offline"

    var body: some View {
        let background = useDark ? TranBrandTokens.Dark.background : TranBrandTokens.Light.background
        let textPrimary = useDark ? TranBrandTokens.Dark.textPrimary : TranBrandTokens.Light.textPrimary
        let canVote = useDark ? TranBrandTokens.Dark.eligibilityCanVote : TranBrandTokens.Light.eligibilityCanVote
        let cannotVote = useDark ? TranBrandTokens.Dark.eligibilityCannotVote : TranBrandTokens.Light.eligibilityCannotVote
        let primary = useDark ? TranBrandTokens.Dark.primary : TranBrandTokens.Light.primary

        ZStack {
            background.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text("TRAN / iOS")
                    .font(.headline)
                    .foregroundStyle(textPrimary)
                Text("Offline voting (UniFFI → rust-core)")
                    .font(.subheadline)
                    .foregroundStyle(textPrimary.opacity(0.8))

                HStack {
                    TextField("Age", text: $ageText)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                    TextField("Country", text: $countryCode)
                        .textInputAutocapitalization(.characters)
                        .textFieldStyle(.roundedBorder)
                }

                Button("Check offline") {
                    checkOffline(canVote: canVote, cannotVote: cannotVote)
                }
                .buttonStyle(.borderedProminent)
                .tint(primary)

                Text(resultText)
                    .font(.body)
                    .foregroundStyle(textPrimary)
                    .accessibilityIdentifier("offline-result")

                Toggle("Dark theme", isOn: $useDark)
                    .tint(primary)
            }
            .padding(24)
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
