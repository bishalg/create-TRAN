# Verifies: REQ-ERR-005 REQ-ERR-006 REQ-ERR-007 REQ-ERR-008 REQ-ERR-009
Feature: Errors and feedback
  As a visitor
  I want every failure explained calmly in my language, and risky actions confirmed
  So that I am never stuck, surprised, or shown a developer message

  The policy (codes, retries, toast durations, dialogs) lives in Rust (ADR-0028).
  These scenarios run the real web app against the real API, intercepting it where a
  failure has to be staged.

  Background:
    Given I open the voting eligibility app

  Scenario: A server check is acknowledged with a short toast
    When I ask the server with age "30" and country "US"
    Then a "success" toast says "Server check complete"
    And the toast disappears after about 3 seconds

  Scenario: A flaky server is retried
    Given the server fails once with 503
    When I ask the server with age "16" and country "BR"
    Then I am told I am "Eligible to vote"
    And the result shows "Checked by the server"
    And the server was asked 2 times

  Scenario: A broken server is explained and the device answers instead
    Given the server always fails with 500 and request id "req-e2e-500"
    When I ask the server with age "17" and country "US"
    Then an "error" toast says "Something went wrong on our side"
    And the toast shows "Reference: req-e2e-500"
    And I am told I am "Not eligible to vote"
    And the result shows "The server could not answer — checked on this device."
    And the server was asked 3 times

  Scenario: Server errors are explained in the user's language
    When I switch the language to "NE"
    And I ask the server in Nepali with age "30" and country "U1"
    Then I see the error "देश दुई अक्षरको हुनुपर्छ"

  Scenario: Losing the server mid-session shows a banner and keeps answering
    Given the API goes away
    When I ask the server with age "20" and country "NP"
    Then I see the offline notice
    And I am told I am "Eligible to vote"
    And the result shows "The server could not answer — checked on this device."

  # Confirming and cancelling sign-out by tapping are screen contract scenarios
  # (e2e/features/screens/eligibility.feature). Escape and the focus it restores are web-only.
  Scenario: Cancelling sign-out with Escape keeps the session and restores focus
    When I click the sign out button
    And I press Escape
    Then no dialog is open
    And I see the user role badge "Citizen Voter"
    And the sign out button has focus

  # Verifies: REQ-ERR-010
  Scenario: An expired session asks to sign in again
    Given the server always fails with 401 and code "auth.session_expired"
    When I ask the server with age "30" and country "US"
    Then a dialog asks "Your session has expired"
    And the server was asked 1 times
    When I confirm the dialog with "Sign in again"
    Then I see the role selection options "Continue as Citizen Voter" and "Continue as Election Auditor"

  # Verifies: REQ-ERR-012
  Scenario: A repeated failure shows one toast, not a pile
    Given the server always fails with 403 and code "auth.forbidden"
    When I ask the server with age "30" and country "US"
    And I ask the server again
    Then an "error" toast says "You don't have permission to do that."
    And exactly 1 toast is shown

  # Verifies: REQ-ERR-013
  Scenario: The offline notice clears by itself when the network returns
    Given the API goes away
    When I ask the server with age "20" and country "NP"
    Then I see the offline notice
    When the API comes back and the browser reports it is online
    Then I do not see the offline notice
    And the API status is "API online"
