# Verifies: REQ-WEB-001 REQ-WEB-003 REQ-WEB-004 REQ-WEB-007 REQ-WEB-014 REQ-A11Y-001 REQ-A11Y-003 REQ-A11Y-004 REQ-A11Y-005 REQ-A11Y-006 REQ-I18N-002 REQ-I18N-006
Feature: Voting eligibility
  As a visitor
  I want to know whether I am old enough to vote in a country
  So that I can trust the answer whether I am online or offline

  The same rules run in two places: on the device (TypeScript) and on the server
  (Rust behind Axum). These scenarios drive the real web app against the real API.

  Background:
    Given I open the voting eligibility app

  Scenario Outline: The device decides by age and country
    When I check on this device with age "<age>" and country "<country>"
    Then I am told I am "<verdict>"
    And the result says "<reason>"

    Examples:
      | age | country | verdict              | reason                                              |
      | 20  | NP      | Eligible to vote     | Age 20 meets the minimum voting age of 18 in NP.    |
      | 17  | US      | Not eligible to vote | Age 17 is below the minimum voting age of 18 in US. |
      | 16  | BR      | Eligible to vote     | Age 16 meets the minimum voting age of 16 in BR.    |

  Scenario: The Rust server gives the same answer as the device
    When I ask the server with age "16" and country "BR"
    Then I am told I am "Eligible to vote"
    And the result says "Age 16 meets the minimum voting age of 16 in BR."
    And the result shows "Checked by the server"

  Scenario: The server rejects a malformed country and the app stays online
    When I ask the server with age "30" and country "U1"
    Then I see the error "Country code must be two ASCII letters"
    And I do not see the offline notice

  Scenario Outline: Invalid ages are explained, not ignored
    When I check on this device with age "<age>" and country "US"
    Then I see the error "Enter a whole-number age between 0 and 150."

    Examples:
      | age  |
      | abc  |
      | -1   |
      | 151  |
      | 21.5 |

  Scenario: Device checks keep working when the API is unreachable
    Given the API is unreachable
    When I check on this device with age "30" and country "US"
    Then I see the offline notice
    And I am told I am "Eligible to vote"

  Scenario: The footer shows the API is online
    Then the API status is "API online"

  Scenario Outline: Every theme in the registry applies its colour scheme
    When I switch to the "<theme>" theme
    Then the page uses the "<theme>" theme
    And the page reports the "<scheme>" colour scheme

    Examples:
      | theme | scheme |
      | light | light  |
      | dark  | dark   |
      | black | dark   |
      | sepia | light  |

  Scenario: A theme choice is remembered and applied before first paint
    When I switch to the "sepia" theme
    And I reload the page with the app code blocked
    Then the page uses the "sepia" theme

  Scenario: Results are announced to screen readers
    Then an empty "Result" live region is already on the page
    When I check on this device with age "30" and country "US"
    Then the "Result" live region says "Eligible to vote"

  Scenario: Switching the language localizes the whole interface
    When I switch the language to "NE"
    Then the document language is "ne"
    And the page heading says "मतदान योग्यता"
    And the age field is labelled "तपाईंको उमेर"
    And the submit button says "योग्यता जाँच्नुहोस्"
    When I switch the language to "HI"
    Then the document language is "hi"
    And the page heading says "मतदान पात्रता"
    When I switch the language to "EN"
    Then the document language is "en"
    And the page heading says "Voting Eligibility"

  Scenario: The result sentence is localized, not English prose from the core
    # Verifies: REQ-I18N-007
    When I check on this device with age "17" and country "US"
    And I switch the language to "NE"
    Then the result says "उमेर 17 न्यूनतम मतदान उमेर 18 भन्दा कम छ (US)।"
    When I switch the language to "HI"
    Then the result says "आयु 17 न्यूनतम मतदान आयु 18 से कम है (US)।"

  Scenario: Invalid input moves focus to the age field
    When I check on this device with age "abc" and country "US"
    Then the age field has focus

  Scenario: A keyboard-only user can complete a check
    When I type age "30" and press Enter using only the keyboard
    Then I am told I am "Eligible to vote"

  Scenario Outline: The page has no accessibility violations
    When I switch to the "<theme>" theme
    And I check on this device with age "17" and country "US"
    Then the page has no detectable accessibility violations

    Examples:
      | theme |
      | dark  |
      | light |
      | black |
      | sepia |

  Scenario: The layout never scrolls sideways on a phone
    Given I use a phone-sized screen
    Then the page does not scroll horizontally
