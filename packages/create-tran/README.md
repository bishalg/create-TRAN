# create-tran

Scaffold a TRAN monorepo (TanStack + Rust + Axum + Swift/Kotlin) with interactive onboarding.

```bash
npx create-tran
# Press Enter through defaults for a quick start.
# Color Enter = random pick from 5 template brand swatches.

npx create-tran my-app --prefix acme --primary '#0ea5e9' --theme light --yes
```

## Quick path (Enter / Enter / …)

Every question shows a default in parentheses. Press **Enter** to accept and move on.

| Step            | Default       | Enter does                                        |
| --------------- | ------------- | ------------------------------------------------- |
| Project name    | `my-tran-app` | Accept                                            |
| Code prefix     | `tran`        | Accept                                            |
| Primary color   | _(random)_    | Random from Ocean / Sky / Indigo / Violet / Sepia |
| Native apps     | Yes           | Include iOS + Android                             |
| Package manager | `pnpm`        | Accept                                            |
| Advanced?       | No            | Skip advanced and scaffold                        |

Or type `1`–`5` for a specific swatch, or a custom `#hex`.

## Advanced (optional)

Answer **y** to “Configure advanced options?” for:

- App display name (written into `locales/*/common.json`)
- Default theme (`light` / `dark` / `black` / `sepia`)
- Git init yes/no

## Flags (non-interactive)

| Flag                    | Effect                                                               |
| ----------------------- | -------------------------------------------------------------------- |
| `--prefix` / `--stem`   | Code prefix rewrite                                                  |
| `--primary` / `--color` | Brand primary (no random)                                            |
| `--theme`               | Default theme mode                                                   |
| `--display-name`        | Locale brand / app name                                              |
| `--no-native`           | Drop iOS + Android                                                   |
| `--no-git`              | Skip `git init`                                                      |
| `--yes`                 | No prompts; deterministic (keeps template colors unless `--primary`) |

## After scaffold

```bash
cd my-app
pnpm install
pnpm tokens:sync   # if you changed prefix, color, or theme
pnpm run dev
```
