# ADR-0007 BDD scenarios are acceptance criteria

Status: accepted

## Context

Unit tests do not prove a user can finish the task.

## Decision

Gherkin features in `e2e/` (Playwright + playwright-bdd) run the real API and web app.

## Consequences

Every user-visible requirement has a scenario. Slower than unit tests, so used for journeys only.
