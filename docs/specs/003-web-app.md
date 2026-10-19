# 003 Web app

Scope: behaviour and accessibility of `apps/web`. Rendering, routing and metadata are in
[004](./004-ssr-seo.md). Rationale: [ADR-0005](../adr/0005-generated-design-tokens.md),
[ADR-0008](../adr/0008-accessibility-is-tested.md), [ADR-0013](../adr/0013-feature-based-web-structure.md).

## Behaviour

### REQ-WEB-001 [verified] Two places to run the check

The user MUST be able to run an eligibility check **on this device** (shared TypeScript rules, no network) or **by the
server** (Rust via the API). Each mode keeps its own last result; switching mode shows that mode's result.
**Verified by:** `App.test.tsx`, BDD "device decides" and "server gives the same answer".

### REQ-WEB-002 [verified] Strict input

The age field MUST accept only whole numbers 0–150 (`"21abc"`, `""`, `"-1"`, `"21.5"` are invalid; nothing is silently
truncated). The country field MUST be upper-cased and limited to two letters.
**Verified by:** `parse-age.test.ts`, `App.test.tsx`, BDD "Invalid ages are explained".

### REQ-WEB-003 [verified] Errors are classified, not lumped together

Invalid input, a server rejection (4xx) and an unreachable server MUST be distinguishable: input and rejection errors
appear as an alert with the message; an unreachable server appears as a notice and MUST NOT be reported as a validation
error. A rejection MUST NOT mark the API offline.
**Verified by:** `useTranApi.test.tsx`, `App.test.tsx`, BDD "rejects a malformed country and the app stays online".

### REQ-WEB-004 [verified] Device checks survive an outage

When the API is unreachable, checks on this device MUST still work.
**Verified by:** BDD "Device checks keep working when the API is unreachable".

### REQ-WEB-005 [verified] Result is not conveyed by colour alone

The verdict MUST be present as text and an icon in addition to colour, and MUST show the country, the minimum age and
where the check ran.
**Verified by:** `ResultCard.test.tsx`.

### REQ-WEB-006 [verified] In-flight state

While a server check is running the submit button MUST be disabled, show a progress label and expose `aria-busy`.
**Verified by:** `App.test.tsx`, `useTranApi.test.tsx`.

### REQ-WEB-007 [planned] Theme preference

The first render MUST follow the OS colour-scheme preference. A user's explicit choice MUST be remembered across visits
and MUST be applied before first paint so there is no flash of the wrong theme.
**Verified by:** `usePreferences.test.tsx`, BDD "theme is remembered".

### REQ-WEB-008 [verified] Translations

All user-visible strings MUST come from the dictionaries; `en`, `ne` and `hi` MUST have identical key sets and no empty values.
**Verified by:** `i18n.test.ts`.

### REQ-WEB-009 [verified] Tokens only

Colours MUST come from the generated `--tran-*` variables (or `color-mix()` of them). Shared typography atoms (`TranText`) MUST map variants to those variables via CSS, not ad-hoc hex in components.
**Verified by:** `TranText.test.tsx`, [docs/ATOMIC.md](../ATOMIC.md).

## Accessibility (target: WCAG 2.2 level AA)

### REQ-A11Y-001 [verified] No automated violations

Every page in both themes MUST have no axe-core violations for the WCAG 2 A and AA rule sets.
**Verified by:** BDD "no accessibility violations" (both themes, with a result displayed).

### REQ-A11Y-002 [verified] Programmatic labels

Every input MUST have a visible `<label>`; hints MUST be linked with `aria-describedby`; invalid fields MUST set `aria-invalid`.
**Verified by:** `Field.test.tsx`, `App.test.tsx`.

### REQ-A11Y-003 [verified] Announcements

The result MUST be rendered in a live region (`role="status"`) that exists before the first result; errors MUST use
`role="alert"`.
**Verified by:** `App.test.tsx`, BDD "Results are announced to screen readers".

### REQ-A11Y-004 [verified] Focus management

After submitting an invalid age, focus MUST move to the age field.
**Verified by:** `App.test.tsx`, BDD "Invalid input moves focus to the age field".

### REQ-A11Y-005 [verified] Keyboard operable

Every function MUST be usable with the keyboard alone, with a visible focus indicator.
**Verified by:** BDD "A keyboard-only user can complete a check".

### REQ-A11Y-006 [verified] Document language

`<html lang>` MUST match the selected language.
**Verified by:** `App.test.tsx`, BDD "Switching language updates the document language".

### REQ-A11Y-007 [planned] Reflow

At a 320 CSS-pixel viewport the page MUST NOT scroll horizontally.
**Verified by:** BDD "layout never scrolls sideways".

### REQ-A11Y-008 [planned] Target size

Interactive controls MUST be at least 44×44 CSS pixels.
**Verified by:** BDD "controls are large enough to tap".

### REQ-A11Y-009 [planned] Reduced motion

When the user prefers reduced motion, no animation or transition MUST run.
**Verified by:** BDD "motion is removed when the user asks for less".

### REQ-A11Y-010 [planned] Landmarks and skip link

Every page MUST have exactly one `<h1>`, a `header`, `nav`, `main` and `footer` landmark, and a "Skip to content" link
as the first focusable element that moves focus to `main`.
**Verified by:** BDD "Keyboard users can skip the navigation".
