# Contributing to create-TRAN

Thanks for improving the TRAN template. This repo follows conventions inspired by [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo).

## Monorepo layout

| Path                   | Role                                                        |
| :--------------------- | :---------------------------------------------------------- |
| `apps/web`             | TanStack + Vite web client                                  |
| `apps/native`          | Expo mobile client                                          |
| `apps/api`             | Axum HTTP API (Rust)                                        |
| `crates/rust-core`     | Domain rules (source of truth)                              |
| `packages/core-ts`     | Shared TS SDK, tokens, i18n, offline rule mirror            |
| `packages/api`         | oRPC contract + Zod schemas + typed client                  |
| `packages/create-tran` | Scaffolding CLI                                             |
| `tooling/typescript`   | Shared `tsconfig` bases                                     |
| `e2e`                  | Playwright + Gherkin (BDD) against the real API and web app |
| `fixtures`             | Golden cases shared by Rust and TypeScript tests            |

## Development

```bash
pnpm install
pnpm dev:api    # Axum on :3001
pnpm dev:web
pnpm test       # cargo test + vitest
pnpm typecheck
```

Work test-first; the full playbook is in [docs/TESTING.md](./docs/TESTING.md). Coverage is gated at 100% (`pnpm test:coverage`) and user-visible behaviour needs a Gherkin scenario in `e2e/features/` (`pnpm test:e2e`).

TypeScript offline rules in `packages/core-ts/src/voting.ts` must stay aligned with `crates/rust-core/src/voting.rs`; the shared `fixtures/vote-eligibility.json` enforces it.

## Pull requests

- Branch from `dev`
- Keep files focused (aim for &lt; 800 lines per file)
- Run `pnpm test:all`, `pnpm typecheck`, and `pnpm lint` before opening a PR
- Update README / `.env.example` when env vars or demo flows change

## License

MIT — see [LICENSE](./LICENSE).
