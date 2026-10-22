# Verifies: REQ-LOAD-002 REQ-LOAD-003 REQ-LOAD-004 REQ-LOAD-005
Feature: Waiting, leaving and losing the server
  As a visitor
  I want to know when an answer is on its way, keep what I already had, and be told who answered
  So that a slow or missing server never leaves me guessing

  The waiting policy lives in Rust (ADR-0035): a progress indicator appears only after
  300 ms, the last verdict is never blanked, and a check is abandoned when I leave.
  Delays and failures are staged by intercepting the API; waits use the real policy.

  Background:
    Given I open the voting eligibility app

  Scenario: A fast server answer shows no progress indicator
    # Verifies: REQ-LOAD-002
    Given I start watching the result region
    And the server answers after 100 milliseconds
    When I ask the server with age "30" and country "US"
    Then I am told I am "Eligible to vote"
    And the result region was never busy
    And the submit button says "Check eligibility"

  Scenario: A slow server shows progress after a moment
    # Verifies: REQ-LOAD-002
    Given the server answers after 1500 milliseconds
    When I ask the server with age "30" and country "US"
    Then the result region is busy and says "Checking with the server…"
    And the submit button says "Checking…"
    And I am told I am "Eligible to vote"
    And the result shows "Checked by the server"
    And the result region is not busy
    And the submit button says "Check eligibility"

  Scenario: The last result stays visible while a new check runs
    # Verifies: REQ-LOAD-003
    When I ask the server with age "30" and country "US"
    Then I am told I am "Eligible to vote"
    Given the server holds the next answer
    When I ask the server with age "10" and country "US"
    Then the result region is busy and says "Checking with the server…"
    And I am told I am "Eligible to vote"
    When the server answers now
    Then I am told I am "Not eligible to vote"
    And the result says "Age 10 is below the minimum voting age of 18 in US."
    And the result shows "Checked by the server"
    And the result region is not busy

  Scenario: Leaving the screen discards a late answer
    # Verifies: REQ-LOAD-004
    Given the server holds the next answer
    When I ask the server with age "30" and country "US"
    And I click the sign out button
    And I confirm the dialog with "Sign out"
    Then I see the role selection options "Continue as Citizen Voter" and "Continue as Election Auditor"
    When the server answers now
    Then the held request was aborted
    And no toast is shown

  Scenario: The server cannot be reached: the device decides and says so
    # Verifies: REQ-LOAD-005
    Given the API goes away
    When I ask the server with age "20" and country "NP"
    Then I am told I am "Eligible to vote"
    And the result shows "The server could not answer — checked on this device."
    And I see the offline notice
