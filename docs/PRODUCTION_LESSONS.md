# Production lessons (from AstroFusion → TRAN)

Short patterns we borrow when building this template — not a full post-mortem.

## Token-bound atoms

- **AFText** centralises typography: variants resolve to a shared token map (`textVariants`), not per-screen class strings.
- **TRAN** uses **TranText** with `data-variant` + CSS variables from `theme.css`. Changing `tokens.rs` and running `pnpm tokens:sync` restyles every consumer.

## Do not invent colours

Production apps drift when engineers add `#334155` for “just this once.” AstroFusion keeps semantic colours in the theme; TRAN enforces the same via generated `--tran-color-*` and `color-mix()` on those vars in `app.css`.

## Accessibility by default

- Infer semantic elements from variant where safe (`title` → heading, `body` → paragraph).
- Allow **`as`** overrides to avoid invalid nesting (paragraph styles inside an existing `<p>`).
- Keep live regions and alerts on real roles (`role="alert"`, `role="status"`) — TranText does not replace ARIA when the UX requires it.

## Cross-platform naming

Use the same variant names on web now so Swift/Kotlin wrappers later stay documented in one place ([docs/ATOMIC.md](./ATOMIC.md)).

## Test the contract

Unit tests assert **element choice** and **variant hooks** (`data-variant`, classes), not pixel-perfect snapshots — tokens change; semantics should not.
