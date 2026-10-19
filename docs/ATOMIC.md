# Atomic UI (web)

TRAN’s web sample uses a thin **atom layer** under `apps/web/src/shared/ui/`, inspired by AstroFusion’s **AFText** pattern: one typography primitive whose variants map to **design tokens only**, not ad-hoc hex or Tailwind color names.

## TranText

| Variant   | Default element | Token-backed role                          |
| :-------- | :-------------- | :----------------------------------------- |
| `title`   | `h2`            | Primary heading weight/size (`--fg`)       |
| `body`    | `p`             | Default copy (`--fg`)                      |
| `caption` | `span`          | Secondary size (`--fg-muted`)              |
| `muted`   | `p`             | De-emphasized copy (`--fg-muted`)          |
| `success` | `p`             | Positive semantic (`--tran-color-success`) |
| `danger`  | `p`             | Error semantic (`--tran-color-danger`)     |

Use the optional **`as`** prop when semantics differ from the default (e.g. hero `as="h1"`, alert `as="p"` with `role="alert"`).

Styles live in `apps/web/src/styles/app.css` on `.tran-text[data-variant=…]` and reference `--tran-*` variables from `theme.css` (generated from Rust). Do **not** invent new colours in components.

## TranStack

Optional vertical flex helper with `gap` mapped to `--tran-spacing-*` or `--space-*` aliases — same token pipeline as layout elsewhere in the web app.

## Native (**N**)

iOS (SwiftUI) and Android (Compose) will get parallel wrappers (`TranText`-style) that read generated `BrandTokens` — not implemented in this template slice yet. Keep variant names aligned so docs and specs stay cross-platform.

## When to add atoms

- Shared typography, spacing, or feedback that appears in more than one feature.
- Anything that must stay in sync with `crates/rust-core/src/tokens.rs` after `pnpm tokens:sync`.

Prefer feature-local markup for one-off layout; promote to `shared/ui` when a second screen needs the same contract.

See also [docs/DESIGN.md](./DESIGN.md) and [docs/PRODUCTION_LESSONS.md](./PRODUCTION_LESSONS.md).
