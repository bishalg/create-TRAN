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
    And the result was checked "by the server"

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

  Scenario: The page can be used in the light theme
    When I switch to the "light" theme
    Then the page uses the "light" theme

  Scenario Outline: The page has no accessibility violations
    When I switch to the "<theme>" theme
    And I check on this device with age "17" and country "US"
    Then the page has no detectable accessibility violations

    Examples:
      | theme |
      | dark  |
      | light |

  Scenario: The layout never scrolls sideways on a phone
    Given I use a phone-sized screen
    Then the page does not scroll horizontally
