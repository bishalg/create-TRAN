import SwiftUI

/// Voting demo — brand tokens + offline rust-core rules via UniFFI.
/// Copy comes from the shared dictionaries through the generated String Catalog.
struct VotingHomeView: View {
    @Binding var theme: TranTheme
    @State private var ageText = "20"
    @State private var countryCode = "NP"
    @State private var resultText = L10n.Eligibility.resultPlaceholder
    /// Why the last check was refused; verdicts stay in `resultText` (REQ-NAT-002, ADR-0038).
    @State private var validationMessage: String?
    @State private var apiStatus: TranApiStatus = .checking
    /// A connectivity failure shown until a call succeeds (REQ-ERR-006).
    @State private var banner: TranRequestFailure?
    /// The server's background confirmation of the verdict on screen (REQ-LOAD-002..005).
    @State private var confirmation = ServerConfirmation()
    /// Whether `resultText` is a device verdict, so the source caption has something to describe.
    @State private var hasVerdict = false
    /// Re-asks the server while the banner is up (REQ-ERR-013).
    @State private var recovery = RecoveryProbe()
    /// "Use my location", asked only on a tap and after the priming (spec 026).
    @State private var location = TranLocationPermission(gateway: TranPermissionLaunch.shared)
    @Environment(TranFeedback.self) private var feedback
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var onSignOut: (() -> Void)? = nil
    /// Asks, then deletes; a failure comes back for the screen's own banner (REQ-ACC-006).
    var onDeleteAccount: TranAccountDeletion.Request? = nil
    var api: TranApiClient = TranApiClient()

    var body: some View {
        TranScreen {
            ScrollView {
                TranBox(padding: .lg) {
                    TranStack(gap: .md, alignment: .leading) {
                        if let onSignOut, let onDeleteAccount {
                            SignedInHeader(
                                signOutId: ScreenContract.Eligibility.signOutButton,
                                deleteAccountId: ScreenContract.Eligibility.deleteAccountButton,
                                onSignOut: onSignOut,
                                onDeleteAccount: { onDeleteAccount { failure in failed(failure) } }
                            ) { titles }
                        } else {
                            titles
                        }

                        TranStack(gap: .base, alignment: .leading) {
                            TranField(
                                label: L10n.Eligibility.ageLabel,
                                hint: L10n.Eligibility.agePlaceholder,
                                text: $ageText,
                                identifier: ScreenContract.Eligibility.ageField,
                                keyboard: .numberPad
                            )
                            TranField(
                                label: L10n.Eligibility.countryLabel,
                                hint: L10n.Eligibility.countryPlaceholder,
                                text: $countryCode,
                                identifier: ScreenContract.Eligibility.countryField,
                                autocapitalization: .characters
                            )
                            UseLocationControl(location: location, countryCode: $countryCode)
                        }

                        TranButton(label: L10n.Eligibility.checkOffline, fullWidth: true) {
                            checkOffline()
                        }
                        .accessibilityIdentifier(ScreenContract.Eligibility.checkButton)

                        if let validationMessage {
                            TranText(validationMessage, variant: .danger, live: true, label: L10n.Eligibility.validationLabel)
                                .accessibilityIdentifier(ScreenContract.Eligibility.validationMessage)
                        }

                        TranStack(gap: .xs, alignment: .leading) {
                            TranText(resultText, live: true, label: L10n.Eligibility.resultLabel)
                                .accessibilityIdentifier(ScreenContract.Eligibility.offlineResult)
                            // The verdict stays as it is while the server checks; only this caption
                            // says who vouches for it, or that the check is still running (REQ-LOAD-003).
                            if hasVerdict {
                                TranText(confirmation.caption, variant: .caption, live: true, label: L10n.Eligibility.resultSource)
                                    .accessibilityIdentifier(ScreenContract.Eligibility.verdictSource)
                            }
                        }
                        .animation(TranMotion.animation(reduceMotion: reduceMotion), value: confirmation.caption)

                        // Theme choices come from the rust-core registry: every case renders here,
                        // with its label from the shared dictionaries (`shell.theme.<mode>`).
                        TranSegmented(
                            options: TranTheme.allCases,
                            selection: $theme,
                            label: { $0.label },
                            accessibilityLabel: L10n.Shell.themeLabel,
                            identifier: ScreenContract.Eligibility.themePicker,
                            optionName: { $0.rawValue }
                        )

                        // REQ-NAT-011: the status pill mirrors the web footer; it never gates the device check.
                        TranText(statusLabel, variant: .caption, live: true, label: L10n.Shell.statusLabel)
                            .accessibilityIdentifier(ScreenContract.Eligibility.apiStatus)
                        if let banner {
                            TranBanner(message: TranFeedback.message(banner.spec.messageKey))
                                .accessibilityIdentifier(ScreenContract.Eligibility.offlineNotice)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            // The number pad has no return key: a drag puts it away, so at the largest text size
            // the header the keyboard pushed off screen can be reached again (REQ-NAT-004).
            .scrollDismissesKeyboard(.interactively)
        }
        .task {
            await refreshApiStatus()
        }
        // The banner recovers by itself: probe on the Rust schedule, and at once when the network
        // returns or the app comes back to the foreground (REQ-ERR-013).
        .onChange(of: banner != nil) { _, offline in
            if offline {
                let api = api
                recovery.start(probe: { try await api.probeHealth() }, onRecovered: { succeeded() })
            } else {
                recovery.stop()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { recovery.nudge() }
        }
        .task {
            for await _ in TranConnectivity.becameReachable() { recovery.nudge() }
        }
        // Leaving the screen abandons the confirmation and the recovery; their late answers are
        // silent (REQ-LOAD-004).
        .onDisappear {
            confirmation.cancel()
            recovery.stop()
        }
    }

    private var titles: some View {
        TranStack(gap: .xs, alignment: .leading) {
            TranText(L10n.Shell.header("iOS"), variant: .title)
            TranText(L10n.Eligibility.subtitle, variant: .muted)
            TranText(L10n.Common.roleCitizenVoter, variant: .caption, label: L10n.Common.roleLabel)
                .accessibilityIdentifier(ScreenContract.Eligibility.roleBadge)
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
    /// retrying transient failures, and the catalogue decides how the outcome is shown. A newer
    /// check replaces this one (REQ-ROB-006).
    private func confirmWithApi(age: UInt16) {
        let api = api
        let countryCode = countryCode
        confirmation.start {
            try await api.confirmEligibility(age: age, countryCode: countryCode)
        } onFinish: { outcome in
            switch outcome {
            case .confirmed:
                succeeded()
                feedback.acknowledge(.serverCheckSucceeded)
            case let .failed(failure):
                feedback.report(failure)
                failed(failure)
            case .cancelled:
                // Logged at the catalogue's level (debug) and shown nowhere.
                feedback.log(TranRequestFailure(code: .requestCancelled))
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
        // An age that is not a whole number is out of range, in the catalogue's words.
        guard let age = UInt16(ageText) else {
            showProblem(TranFeedback.message(errorSpec(code: .validationAgeOutOfRange).messageKey))
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
            validationMessage = nil
            hasVerdict = true
            confirmWithApi(age: age)
        } catch let error as TranValidationError {
            // Map the typed Rust variant to shared copy instead of Rust prose.
            showProblem(error.localizedMessage)
        } catch {
            showProblem(L10n.Errors.unexpected)
        }
    }

    /// No verdict to confirm: an older confirmation must not describe this message, and the
    /// result goes back to its placeholder so a refusal is never read as a verdict.
    private func showProblem(_ message: String) {
        confirmation.cancel()
        hasVerdict = false
        resultText = L10n.Eligibility.resultPlaceholder
        validationMessage = message
    }
}
