# Verifies: REQ-ACC-006 REQ-ACC-007
Feature: Deleting an account
  As a person with a TRAN Voting account
  I want to delete it, and to read how without installing the app
  So that my data is gone when I ask for it

  Asking first, Cancel and an unreachable server are screen contract scenarios
  (e2e/features/screens/, ADR-0038). What stays here is web-only: the public page the
  stores link to, and a deletion the real API confirms, which no native suite can stage.

  @REQ-ACC-007
  Scenario: The public page explains deletion without signing in
    Given I open the account deletion page
    Then it explains how to delete, what is deleted and what is kept in every app language
    And the page has no detectable accessibility violations
    And the page does not scroll horizontally

  @REQ-ACC-007
  Scenario: The public page leads to the web app
    Given I open the account deletion page
    When I follow the link to the web app
    Then I see role selection

  @REQ-ACC-006
  Scenario: Confirming deletes the account and returns to role selection
    Given I am signed in to the API as an election auditor
    When I delete my account and confirm
    Then I see role selection
    And I am told my account was deleted
    And after a reload I still see role selection
