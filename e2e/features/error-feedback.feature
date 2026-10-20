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
    And the result shows "Checked on this device"
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
    And the result shows "Checked on this device"

  Scenario: Signing out asks for confirmation
    When I click the sign out button
    Then a dialog asks "Sign out?"
    When I confirm the dialog with "Sign out"
    Then I see the role selection options "Continue as Citizen Voter" and "Continue as Election Auditor"

  Scenario: Cancelling sign-out keeps the session
    When I click the sign out button
    And I press Escape
    Then no dialog is open
    And I see the user role badge "Citizen Voter"
    And the sign out button has focus
