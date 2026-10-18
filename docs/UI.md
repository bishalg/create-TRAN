# UI guide (web sample)

The sample UI is deliberately small: one card, one form, one result. Copy its **habits**, not its layout.

```
Header        brand · language (EN/NE/HI) · theme toggle
Hero          title + one-line purpose
Form card     "Where should the check run?" (device | server) · age · country · submit
Result        icon + verdict + reason + facts (country, minimum age, where it ran)
Footer        API online / offline / checking
```

## Rules

1. **Tokens only.** Colours come from the generated `--tran-*` CSS variables (`pnpm tokens:sync`). Derive
   shades with `color-mix()`; never add a hex value to `app.css`. Same tokens drive iOS and Android.
2. **No inline styles.** Styling lives in `apps/web/src/styles/app.css`; components stay structural.
3. **Small components, one job each** (`Field`, `ModeSwitch`, `ResultCard`, `StatusFooter`, `Header`).
   `App.tsx` only holds state and wires them together.
4. **Native elements first.** Radios, `<form>`, `<label>`, `<button>`: keyboard and screen-reader support for free.
5. **Say what happened.** Validation errors and the offline notice are visible text (`role="alert"` / `role="note"`);
   results are announced via `role="status"`. A rejected input is never reported as "offline".
6. **Speak to users, not developers.** No function names, file paths or stack jargon in the UI.
7. **Works everywhere:** follows the OS theme on first paint, 44px touch targets, visible focus rings,
   no horizontal scroll at 390px, respects `prefers-reduced-motion`.
8. **Every string is translated.** Add the key to `en`, `ne` and `hi` (a test enforces identical key sets).

## Proving it

- Component and behaviour tests: `apps/web/tests` (query by role and label).
- Real browser: `e2e/features/vote-eligibility.feature` runs an **axe** WCAG A/AA audit in both themes and
  asserts there is no sideways scroll on a phone. Contrast bugs (e.g. muted text on a tinted card) fail CI.
