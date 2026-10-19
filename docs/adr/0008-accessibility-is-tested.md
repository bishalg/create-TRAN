# ADR-0008 Accessibility is tested, not promised

Status: accepted

## Context

Accessibility regresses silently.

## Decision

axe-core runs in BDD in every registered theme; behaviours axe cannot see (focus, live regions, keyboard) have explicit scenarios; native apps use platform audits.

## Consequences

WCAG 2.2 AA is a merge gate. Automated checks are necessary, not sufficient; manual screen-reader passes remain advised.
