# Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005
Feature: Navigation Director and Role Branching
  As an application user
  I want a launch screen that directs me to role selection or my dashboard
  So that I can choose between Citizen Voter and Election Auditor paths and sign out safely

  Scenario: Central navigation director presents the two branching options
    Given I launch the application
    Then I see the role selection options "Continue as Citizen Voter" and "Continue as Election Auditor"

  Scenario: Branching into the Citizen Voter Dashboard
    Given I launch the application
    When I select the role "Citizen Voter"
    Then I am routed to the "Voting Eligibility" dashboard
    And I see the user role badge "Citizen Voter"

  Scenario: Branching into the Election Auditor Dashboard
    Given I launch the application
    When I select the role "Election Auditor"
    Then I am routed to the "Election Auditor" dashboard
    And I see the global voting age rules for countries

  Scenario: Signing out returns to the role selection screen
    Given I am on the "Voting Eligibility" dashboard as "Citizen Voter"
    When I click the sign out button
    Then I see the role selection options "Continue as Citizen Voter" and "Continue as Election Auditor"
