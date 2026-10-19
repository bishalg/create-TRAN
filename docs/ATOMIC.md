# Atomic UI (web)

TRAN’s web sample uses a thin **atom layer** under `apps/web/src/shared/ui/`. Variants map to **`--tran-*` tokens** from `pnpm tokens:sync` — never ad-hoc hex, px, or `style={{}}` in feature code.

## Atom table

| Atom                              | Role                   | Key props                                                                                                                                |
| :-------------------------------- | :--------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `TranText`                        | Typography & semantics | `variant`: `display` \| `title` \| `body` \| `caption` \| `muted` \| `success` \| `danger`; `as`: `h1`–`h3`, `p`, `span`, `label`, `div` |
| `TranStack`                       | Vertical flex          | `gap`: `xs` \| `sm` \| `md` \| `lg` \| `xl` → `data-gap`                                                                                 |
| `TranInline`                      | Horizontal flex        | same `gap` union → `data-gap`                                                                                                            |
| `TranBox`                         | Padding wrapper        | `padding`: `none` \| `sm` \| `md` \| `lg`                                                                                                |
| `TranSurface`                     | Bordered panel         | `surface`, `radius`, `padding` unions → `data-*`                                                                                         |
| `TranButton`                      | Actions                | `variant`: `primary` \| `secondary`; `size`: `md` \| `lg`; min touch via `--tran-spacing-touch`                                          |
| `TranTable` / `TranTh` / `TranTd` | Tabular data           | class + ref forwarding only                                                                                                              |
| `TranLabel`                       | Radio/checkbox tiles   | native `<label>` for associated controls                                                                                                 |
| `Field`                           | Labelled input         | `label`, optional `hint` via `TranText`                                                                                                  |

Styles live in `apps/web/src/styles/app.css` on `.tran-*` selectors and `[data-variant]` / `[data-gap]` hooks. Generated colours and scales live in `apps/web/src/styles/generated/theme.css`.

## DO

- Change brand spacing, type, and radii in `crates/rust-core/src/tokens.rs`, then `pnpm tokens:sync`.
- Forward `className`, `ref`, and native props from atoms.
- Cite requirements in tests: `// Verifies: REQ-WEB-…`.

## DON'T

- Add `style={{…}}` in components (ESLint fails the build).
- Use raw `<h1>`, `<p>`, `<button>`, `<table>`, etc. outside `shared/ui`.
- Hand-edit files under `*/generated/*`.

## Checklist (new UI)

1. Is there an existing atom variant? If not, add atom + test first.
2. Does `app.css` use only `var(--tran-*)` (no raw `px`/`rem` in rules)?
3. `pnpm --filter web lint` and `pnpm test:ts:coverage` green.

## Native (**N**)

iOS (SwiftUI) and Android (Compose) will mirror these **names** (`TranText`, `TranButton`, …) on generated `BrandTokens` — not duplicated in this slice yet.

See [DESIGN.md](./DESIGN.md) and [ADR-0017](./adr/0017-web-atomic-enforcement.md).
