# Verifies: REQ-WEB-001 REQ-WEB-003 REQ-WEB-007 REQ-WEB-014 REQ-A11Y-001 REQ-A11Y-003 REQ-A11Y-004 REQ-A11Y-005 REQ-A11Y-006 REQ-I18N-002 REQ-I18N-006
Feature: Voting eligibility
  As a visitor
  I want to know whether I am old enough to vote in a country
  So that I can trust the answer whether I am online or offline

  The same rules run in two places: on the device (TypeScript) and on the server
  (Rust behind Axum). These scenarios drive the real web app against the real API.

  Device verdicts, the invalid-age message, an unreachable API, the announced verdict,
  the largest text scale and theme selection are screen contract scenarios
  (e2e/features/screens/, ADR-0038). What stays here is web-only: the server mode,
  the boundary inputs, colour schemes, first paint, language switching, keyboard and
  focus behaviour, axe audits, reflow, target sizes of every control and motion.

  Background:
    Given I open the voting eligibility app

  Scenario: The Rust server gives the same answer as the device
    When I ask the server with age "16" and country "BR"
    Then I am told I am "Eligible to vote"
    And the result says "Age 16 meets the minimum voting age of 16 in BR."
    And the result shows "Checked by the server"

  Scenario: The server rejects a malformed country and the app stays online
    When I ask the server with age "30" and country "U1"
    Then I see the error "Country must be two letters"
    And I do not see the offline notice

  Scenario Outline: Boundary ages are explained, not ignored
    # "abc" is the contract scenario "An age that is not a number is explained".
    When I check on this device with age "<age>" and country "US"
    Then I see the error "Enter a whole-number age between 0 and 150."

    Examples:
      | age  |
      | -1   |
      | 151  |
      | 21.5 |

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

  Scenario: The result's live region exists before the first result
    # The announced sentence itself is the contract scenario "The verdict is announced by
    # the result's live region"; that the region is already on the page is web-only.
    Then an empty "Result" live region is already on the page
    When I check on this device with age "30" and country "US"
    Then the "Result" live region says "Age 30 meets the minimum voting age of 18 in US."

  Scenario: Switching the language localizes the whole interface
    When I switch the language to "NE"
    Then the document language is "ne"
    And the page heading says "मतदान योग्यता"
    And the age field is labelled "तपाईंको उमेर"
    And the submit button says "अफलाइन जाँच"
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
    # Verifies: REQ-A11Y-007
    Given I use a phone-sized screen
    Then the page does not scroll horizontally
    And sign out and every theme stay on screen at full size
    When I check on this device with age "17" and country "US"
    Then the page does not scroll horizontally

  Scenario: Controls are large enough to tap
    # Verifies: REQ-A11Y-008
    Then every button and field is at least 24 CSS pixels tall and wide
    And the "Check offline" button is at least 44 CSS pixels tall

  Scenario: Motion is removed when the user asks for less
    # Verifies: REQ-A11Y-009
    Given the user prefers reduced motion
    When I check on this device with age "17" and country "US"
    Then no animation or transition runs

  Scenario: Keyboard users can skip the navigation
    # Verifies: REQ-A11Y-010
    When I press Tab once
    Then the "Skip to content" link has focus
    When I press Enter
    Then the main landmark has focus
    And the page has exactly one h1 and one each of header, main and footer
