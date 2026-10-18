# Specs

Specs say **what the system must do**. They are short, numbered and testable. ADRs (in [`../adr`](../adr))
say **why** we chose a design. Tests prove the spec; code satisfies the tests.

```
spec  ──►  ADR (only if a design choice is made)  ──►  failing test  ──►  code  ──►  spec marked verified
```

## Rules for writing a requirement

- One behaviour per requirement, one sentence, using **MUST** / **MUST NOT** / **SHOULD**.
- Heading format: `### REQ-<AREA>-<NNN> [verified|planned] Short title`. IDs are stable; never reuse one.
- State **how it is verified** (unit, API, parity fixture, BDD, a11y audit).
- Write the spec first and mark it `[planned]`. Flip it to `[verified]` in the same change that adds the tests.
- Behaviour and numbers go in the spec; rationale goes in an ADR. Do not duplicate `docs/API.md` examples here.

## Traceability (enforced)

Tests cite the requirement they prove, in the test name, a comment, or a Gherkin tag:

```ts
it('[REQ-RULE-003] is eligible exactly at the minimum age', ...)
```

```gherkin
@REQ-SEO-004
Scenario: Social previews use a 1200×630 card
```

`pnpm spec:check` (runs in CI) fails when a `verified` requirement has no citing test, or when a test cites an
ID that no spec defines.

## Index

| Spec                                                | Area                                         | Prefix                |
| :-------------------------------------------------- | :------------------------------------------- | :-------------------- |
| [001 Eligibility rules](./001-eligibility-rules.md) | Rust core, TypeScript and native mirrors     | `REQ-RULE`            |
| [002 HTTP API](./002-http-api.md)                   | Axum service, contract, security defaults    | `REQ-API`             |
| [003 Web app](./003-web-app.md)                     | Behaviour, theming, i18n, accessibility      | `REQ-WEB`, `REQ-A11Y` |
| [004 SSR and SEO](./004-ssr-seo.md)                 | TanStack Start, metadata, social cards       | `REQ-SEO`             |
| [005 Native apps](./005-native-apps.md)             | SwiftUI and Compose parity and accessibility | `REQ-NATIVE`          |

## Template

```markdown
### REQ-AREA-001 [planned] Short, specific title

The system MUST … when … .
**Verified by:** unit test `name` / BDD `@REQ-AREA-001`.
```
