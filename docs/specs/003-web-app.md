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

While a server check is running the submit button MUST be disabled and expose `aria-busy` at once; its progress label
follows the indicator delay (REQ-LOAD-002, [018](./018-loading-and-offline.md)).
**Verified by:** `App.test.tsx`, `useTranApi.test.tsx`.

### REQ-WEB-007 [verified] Theme preference

The first render MUST follow the OS colour-scheme preference. A user's explicit choice MUST be remembered across visits
and MUST be applied before first paint so there is no flash of the wrong theme.
**Verified by:** `usePreferences.test.tsx`, BDD "theme is remembered".

### REQ-WEB-008 [verified] Translations

All user-visible strings MUST come from the shared `locales/` dictionaries (see
[008](008-localization.md)); English is the base language and fallback, every locale MUST have
an identical key set with no empty values, and hardcoded copy MUST fail the guard tests.
**Verified by:** [`i18n.test.ts`](../../packages/core-ts/tests/i18n.test.ts),
[`i18n-guards.test.ts`](../../packages/core-ts/tests/i18n-guards.test.ts).

### REQ-WEB-009 [verified] Tokens only

Colours MUST come from the generated `--tran-*` variables (or `color-mix()` of them). Shared typography atoms (`TranText`) MUST map variants to those variables via CSS, not ad-hoc hex in components.
**Verified by:** `TranText.test.tsx`, `TranStack.test.tsx`, [docs/ATOMIC.md](../ATOMIC.md).

### REQ-WEB-010 [verified] Spacing and radii from rust-core

Web layout spacing and corner radii MUST use `--tran-spacing-*` and `--tran-radius-*` from `pnpm tokens:sync`. Local `--space-*` / `--radius-*` literals in `app.css` are forbidden.
**Verified by:** `tokens-guard.test.ts`, atom tests.

### REQ-WEB-011 [verified] Typography semantics in tokens

Title, body, caption, and display type MUST resolve to rust-core typography token fields (size and line-height), not hard-coded rem/px in components.
**Verified by:** `TranText.test.tsx`, `tokens-guard.test.ts`.

### REQ-WEB-012 [verified] Atomic layout and controls

Feature code MUST use shared atoms (`TranStack`, `TranInline`, `TranBox`, `TranSurface`, `TranButton`, `TranTable`, `Field`) for spacing, surfaces, buttons, and tables — no raw semantic HTML tags or `style={{}}` outside `shared/ui`.
**Verified by:** atom tests, ESLint in CI, component tests.

### REQ-WEB-013 [verified] Lint enforcement

`apps/web` ESLint MUST fail on inline `style`, hex/px literals in JSX, and banned semantic tags outside `shared/ui`.
**Verified by:** ESLint config wired into `pnpm lint` and CI.

### REQ-WEB-014 [verified] Theme registry

Every palette in the rust-core theme registry (`light`, `dark`, `black`, `sepia`) MUST be selectable and MUST apply its
own colour tokens. Application code MUST look palettes up by name and MUST NOT branch on a light/dark boolean.
**Verified by:** `Header.test.tsx`, `usePreferences.test.tsx`, `tokens-guard.test.ts`, `ThemeMode` codegen slice in
`crates/tran-tokens-codegen`.

## Accessibility (target: WCAG 2.2 level AA)

### REQ-A11Y-001 [verified] No automated violations

Every page in every registered theme MUST have no axe-core violations for the WCAG 2 A and AA rule sets.
**Verified by:** BDD "no accessibility violations" (every theme, with a result displayed).

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

### REQ-A11Y-007 [verified] Reflow

At a 320 CSS-pixel viewport the page MUST NOT scroll horizontally, before and after a result is shown.
**Verified by:** BDD "The layout never scrolls sideways on a phone".

### REQ-A11Y-008 [verified] Target size

Every button, field and link MUST be at least 24×24 CSS pixels (WCAG 2.2 SC 2.5.8, level AA), and the primary
action MUST be at least 44 CSS pixels tall. Dense secondary controls (language switch) use the 24 px floor.
**Verified by:** BDD "Controls are large enough to tap".

### REQ-A11Y-009 [verified] Reduced motion

When the user prefers reduced motion, no animation or transition MUST run. Under `forced-colors` and
`prefers-contrast: more`, borders MUST stay visible.
**Verified by:** BDD "Motion is removed when the user asks for less" (motion); `forced-colors` and
`prefers-contrast` styles are CSS-only and not yet covered by a test.

### REQ-A11Y-010 [verified] Landmarks and skip link

Every page MUST have exactly one `<h1>`, one `header`, one `main` and one `footer` landmark (there is no site
navigation, so no `nav`), and a localized "Skip to content" link as the first focusable element that moves
focus to `main`.
**Verified by:** BDD "Keyboard users can skip the navigation".
