# Verifies: REQ-NAV-004
Feature: Navigation Director and Role Branching
  As an application user
  I want a launch screen that directs me to role selection or my dashboard
  So that I can choose between Citizen Voter and Election Auditor paths and sign out safely

  Launch, both branches and signing out are screen contract scenarios
  (e2e/features/screens/, ADR-0038). What remains is the auditor dashboard's content,
  which the contract does not declare as an element yet.

  Scenario: Branching into the Election Auditor Dashboard
    Given I launch the application
    When I select the role "Election Auditor"
    Then I am routed to the "Election Auditor" dashboard
    And I see the global voting age rules for countries
