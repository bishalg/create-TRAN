Feature: Voting eligibility
  As a visitor
  I want to know whether I am old enough to vote in a country
  So that I can trust the answer whether I am online or offline

  The same rules run in two places: in the browser (offline) and in Rust behind the
  Axum API. These scenarios drive the real web app against the real API.

  Background:
    Given I open the voting eligibility app

  Scenario Outline: Offline rules decide by age and country
    When I check offline with age "<age>" and country "<country>"
    Then I am told I am "<verdict>"
    And the result says "<reason>"

    Examples:
      | age | country | verdict              | reason                                              |
      | 20  | NP      | Eligible to vote     | Age 20 meets the minimum voting age of 18 in NP.    |
      | 17  | US      | Not eligible to vote | Age 17 is below the minimum voting age of 18 in US. |
      | 16  | BR      | Eligible to vote     | Age 16 meets the minimum voting age of 16 in BR.    |

  Scenario: The Rust API gives the same answer as the offline rules
    When I check via the API with age "16" and debug country "BR"
    Then I am told I am "Eligible to vote"
    And the result says "Age 16 meets the minimum voting age of 16 in BR."

  Scenario: The API rejects a malformed country and the app stays online
    When I check via the API with age "30" and debug country "USA"
    Then I see the error "Country code must be two ASCII letters"
    And I do not see the offline notice

  Scenario Outline: Invalid ages are explained, not ignored
    When I check offline with age "<age>" and country "US"
    Then I see the error "Enter a whole-number age between 0 and 150."

    Examples:
      | age  |
      | -1   |
      | 151  |
      | 21.5 |

  Scenario: Offline rules keep working when the API is unreachable
    Given the API is unreachable
    When I check offline with age "30" and country "US"
    Then I see the offline notice
    And I am told I am "Eligible to vote"

  Scenario: The system status lists every stack layer
    Then the system status is "HEALTHY"
    And the status lists "Rust Domain Core" and "Axum Microservice"
