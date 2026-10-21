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
| Coding agents   | `sample`      | Keep the agent setup, nothing scheduled           |
| Agent harness   | `claude`      | Accept (asked unless agents are `none`)           |
| Advanced?       | No            | Skip advanced and scaffold                        |

Or type `1`–`5` for a specific swatch, or a custom `#hex`.

## Advanced (optional)

Answer **y** to “Configure advanced options?” for:

- App display name (written into `locales/*/common.json`)
- Default theme (`light` / `dark` / `black` / `sepia`)
- Git init yes/no

## Coding agents

The template ships harness-neutral agent tasks in `.agents/` (any of Claude Code, Codex, Gemini CLI, pi or your own;
see [`.agents/README.md`](../../.agents/README.md)). Pick how a new project starts:

| Setup    | What you get                                                                              |
| -------- | ----------------------------------------------------------------------------------------- |
| `sample` | Task files, runner, docs and a GitHub Actions workflow whose schedules stay off           |
| `github` | The same with the schedules on: add the harness's API key secret and they open draft PRs  |
| `none`   | Runner, tasks, workflow and their docs removed; `.agents/skills/` and `LEARNINGS.md` stay |

The harness is written as `defaultHarness` in `.agents/policy.json`. `github` offers `claude`, `codex` and `gemini`, the
CLIs the workflow installs; `sample` also offers `pi`. To pause a `github` project's schedules, set the repository
variable `AGENTS_ENABLED` to `false`.

## Flags (non-interactive)

| Flag                    | Effect                                                               |
| ----------------------- | -------------------------------------------------------------------- |
| `--prefix` / `--stem`   | Code prefix rewrite                                                  |
| `--primary` / `--color` | Brand primary (no random)                                            |
| `--theme`               | Default theme mode                                                   |
| `--display-name`        | Locale brand / app name                                              |
| `--no-native`           | Drop iOS + Android                                                   |
| `--no-git`              | Skip `git init`                                                      |
| `--agents <setup>`      | Coding agents: `sample` (default), `github` or `none`                |
| `--no-agents`           | Same as `--agents none`                                              |
| `--agent-harness <h>`   | Default agent harness: `claude` (default), `codex`, `gemini`, `pi`   |
| `--yes`                 | No prompts; deterministic (keeps template colors unless `--primary`) |

## After scaffold

```bash
cd my-app
pnpm install
pnpm tokens:sync   # if you changed prefix, color, or theme
pnpm run dev
```
