# create-TRAN

[![CI](https://github.com/bishalg/create-TRAN/actions/workflows/ci.yml/badge.svg)](https://github.com/bishalg/create-TRAN/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Use this template](https://img.shields.io/badge/GitHub-Use%20this%20template-24292f.svg)](https://github.com/bishalg/create-TRAN/generate)
[![Nx](https://img.shields.io/badge/Orchestrated%20by-Nx-143055.svg)](https://nx.dev)
[![Rust](https://img.shields.io/badge/Rust-1.80+-orange.svg)](https://www.rust-lang.org)

> **GitHub template** for **TanStack + Rust Core + Axum + Native (Swift iOS + Kotlin Android)** in an Nx / pnpm monorepo — with a cohesive **Voting Eligibility** sample app.

Conventions are aligned with [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo) (app boundaries, shared packages, tooling folder, clear README) while keeping the TRAN stack.

---

## What TRAN means (honest)

| Letter | Layer          | In this repo today                                                                                                                                                                                            |
| :----: | :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **T**  | TanStack (web) | **Vite + React SPA** (`apps/web`). `@tanstack/react-start` / router packages are listed but **not imported** — no SSR, file routes, or server functions yet. See [docs/REVIEW.md](./docs/REVIEW.md).          |
| **R**  | Rust core      | `crates/rust-core` — voting rules, validation, design tokens (source of truth).                                                                                                                               |
| **A**  | Axum           | `apps/api` — REST handlers, stub geo, unified error envelope.                                                                                                                                                 |
| **N**  | Native mobile  | **SwiftUI** (`apps/ios`) + **Jetpack Compose** (`apps/android`). Offline voting via **UniFFI** (`crates/tran-uniffi`). `apps/native` is a **legacy Expo / RN sketch** (interim), not the definition of **N**. |

---

## Quick start

```bash
git clone https://github.com/bishalg/create-TRAN.git my-tran-app
cd my-tran-app
cp .env.example .env
pnpm install
pnpm dev:api   # http://127.0.0.1:3001
pnpm dev:web   # Vite SPA on :3000 (proxies /api → Axum)
```

Or use **[Use this template](https://github.com/bishalg/create-TRAN/generate)** / `npx create-tran my-app`.

**Requirements:** Node.js ≥ 20, pnpm ≥ 9, Rust stable.

**Native apps (optional):** iOS needs Xcode 15+ ([XcodeGen](https://github.com/yonaskolb/XcodeGen) only when regenerating: `brew install xcodegen`); Android needs JDK 17 + Android SDK. After changing Rust FFI, run `pnpm uniffi:generate`. See [apps/ios/README.md](./apps/ios/README.md) and [apps/android/README.md](./apps/android/README.md).

---

## Voting Eligibility demo

One small domain you can extend:

| Path        | Web                                                                    | Native (**N**)                                                | Legacy Expo           |
| :---------- | :--------------------------------------------------------------------- | :------------------------------------------------------------ | :-------------------- |
| **Offline** | `evaluateVoteEligibilityOffline` in `@tran/core` (mirrors `voting.rs`) | `evaluate_vote_eligibility_offline` via UniFFI → `TranEngine` | Same TS mirror as web |
| **API**     | `checkVoteEligibility` / `TranApiClient` + Zod                         | Not wired yet (stretch: URLSession / OkHttp)                  | REST like web         |

**API (async)** — `POST /api/vote/eligibility` uses Rust Core plus a stub geo resolver:

- `X-Forwarded-For` / `X-Real-IP` for client IP
- `X-Debug-Country` (e.g. `US`, `IN`, `NP`, `BR`) — documented as dev-only; **not gated by env in code yet**
- Loopback defaults to `US`; private ranges stub to `IN` for variety

Golden cases live in `fixtures/vote-eligibility.json` (Rust, TypeScript, and UniFFI parity tests).

The web UI follows OS light/dark, uses **design tokens only** (generated CSS + `getThemeTokens()`), locale switching, and accessibility checks in CI (axe + BDD).

### Try it

```bash
curl -s -X POST http://127.0.0.1:3001/api/vote/eligibility \
  -H 'Content-Type: application/json' \
  -H 'X-Debug-Country: NP' \
  -d '{"age": 20}'
```

Full endpoint reference: [docs/API.md](./docs/API.md).

---

## Sample app walkthrough (< 5 minutes)

1. **Install** — `cp .env.example .env`, then `pnpm install`.
2. **API** — `pnpm dev:api` → health at `http://127.0.0.1:3001/api/health`.
3. **Web** — `pnpm dev:web` → eligibility demo (feature-based layout under `apps/web/src/features/eligibility`).
4. **On this device** — **On this device**, age `20`, country `NP`, **Check eligibility** (`evaluateVoteEligibilityOffline`).
5. **Ask the server** — **Ask the server** (`checkVoteEligibility`; country sent as `X-Debug-Country`).
6. **Theme / locale** — header controls; colours from `theme.css` / tokens.
7. **Native (optional)** — `pnpm tokens:sync` then `pnpm uniffi:generate` after FFI changes; open iOS Xcode project or build Android APK (`pnpm ios:build`, `pnpm android:build`). Legacy: `pnpm dev:native` → `apps/native`.
8. **Customize** — `crates/rust-core/src/tokens.rs` → `pnpm tokens:sync`; `voting.rs` → edit fixture first → `cargo test -p rust-core`.

More detail: [docs/SAMPLE_APP.md](./docs/SAMPLE_APP.md). Testing: [docs/TESTING.md](./docs/TESTING.md). UI/a11y notes: [docs/UI.md](./docs/UI.md).

---

## Architecture

```mermaid
graph TD
    subgraph Web ["apps/web — Vite SPA"]
        WUI[Voting UI]
    end
    subgraph Mobile ["apps/ios + apps/android"]
        NUI[SwiftUI / Compose]
    end
    subgraph LegacyRN ["apps/native (interim Expo)"]
        RNUI[RN sketch]
    end
    subgraph FFI ["crates/tran-uniffi"]
        UniFFI[UniFFI exports]
    end
    subgraph Backend ["apps/api Axum"]
        VoteRoute["POST /api/vote/eligibility"]
        Geo[Stub geo / headers]
    end
    subgraph Core ["crates/rust-core"]
        Rules[Voting rules]
    end
    subgraph Shared ["packages"]
        CoreTS["@tran/core tokens + offline mirror"]
        APIPkg["@tran/api oRPC contract + Zod"]
    end

    Web -->|REST + Zod| Backend
    Web -.-> CoreTS
    LegacyRN -->|REST| Backend
    LegacyRN -.-> CoreTS
    Mobile -.->|offline| UniFFI
    UniFFI --> Rules
    Backend --> Rules
    Web -.-> APIPkg
    CoreTS --> APIPkg
```

### Map to create-t3-turbo

| create-t3-turbo              | create-TRAN                                                               |
| :--------------------------- | :------------------------------------------------------------------------ |
| `apps/web`                   | `apps/web` (Vite + React; TanStack Start not wired yet)                   |
| `apps/native` (Expo)         | `apps/native` (legacy interim) + `apps/ios` + `apps/android` (real **N**) |
| `packages/api` (tRPC router) | `packages/api` (oRPC contract + Zod; Axum implements REST)                |
| `packages/ui`                | Design tokens in `@tran/core`; web styles in `apps/web/src/styles`        |
| `packages/db`                | _not included_ (add your own data layer)                                  |
| `tooling/*`                  | `tooling/typescript`                                                      |
| Node API server              | `apps/api` (Rust / Axum) + `crates/rust-core`                             |

---

## Repository layout

```
create-TRAN/
├── apps/
│   ├── api/                 # Axum API
│   ├── web/                 # Vite + React SPA
│   ├── ios/                 # SwiftUI (platform-native N)
│   ├── android/             # Jetpack Compose (platform-native N)
│   └── native/              # Legacy Expo / RN (interim)
├── crates/
│   ├── rust-core/           # Voting rules + tokens (source of truth)
│   ├── tran-uniffi/         # UniFFI surface for iOS/Android offline voting
│   └── tran-tokens-codegen/ # pnpm tokens:sync
├── packages/
│   ├── api/                 # @tran/api — oRPC + Zod
│   ├── core-ts/             # @tran/core — SDK, i18n, themes, offline mirror
│   └── create-tran/         # CLI
├── fixtures/                # vote-eligibility.json (Rust + TS + UniFFI parity)
├── e2e/                     # Playwright + Gherkin
├── tooling/typescript/
├── docs/                    # API, DESIGN, SAMPLE_APP, TESTING, REVIEW, ROADMAP, UI
├── AGENTS.md                # Guidance for AI agents
├── CONTRIBUTING.md
└── Cargo.toml
```

---

## How we work: spec-driven

Every behaviour starts as a numbered requirement, not as code.

1. **Spec**: add or change a requirement in [docs/specs](./docs/specs/README.md) (`REQ-<AREA>-NNN`, status `planned`).
2. **Decision**: if it changes how the system is built, write an [ADR](./docs/adr/0000-template.md).
3. **Red**: write the failing test (unit, golden fixture, or a Gherkin scenario) and cite the ID in it.
4. **Green, refactor**: implement, keep coverage at 100%, flip the requirement to `verified`.
5. `pnpm spec:check` fails if a `verified` requirement has no citing test, or a test cites an unknown ID.

| Specs                                        | Scope                                                    |
| :------------------------------------------- | :------------------------------------------------------- |
| [001](./docs/specs/001-eligibility-rules.md) | Eligibility rules (Rust core, mirrored in TS and native) |
| [002](./docs/specs/002-http-api.md)          | HTTP API                                                 |
| [003](./docs/specs/003-web-app.md)           | Web behaviour and accessibility                          |
| [004](./docs/specs/004-ssr-seo.md)           | Server rendering, SEO, social cards                      |
| [005](./docs/specs/005-native-apps.md)       | iOS and Android                                          |

### Architecture decisions

| ADR                                                    | Decision                              |
| :----------------------------------------------------- | :------------------------------------ |
| [0001](./docs/adr/0001-rust-is-the-source-of-truth.md) | Rust is the source of truth for rules |
| [0002](./docs/adr/0002-golden-fixtures.md)             | Golden fixtures prove parity          |
| [0003](./docs/adr/0003-error-envelope.md)              | One error envelope                    |
| [0004](./docs/adr/0004-inject-time-and-config.md)      | Inject time and configuration         |
| [0005](./docs/adr/0005-generated-design-tokens.md)     | Design tokens are generated           |
| [0006](./docs/adr/0006-coverage-gate.md)               | 100% coverage gate                    |
| [0007](./docs/adr/0007-bdd-as-acceptance.md)           | BDD scenarios are acceptance criteria |
| [0008](./docs/adr/0008-accessibility-is-tested.md)     | Accessibility is tested               |
| [0009](./docs/adr/0009-spec-driven-workflow.md)        | Spec-driven workflow                  |
| [0010](./docs/adr/0010-tanstack-start-ssr.md)          | TanStack Start for SSR                |
| [0011](./docs/adr/0011-seo-metadata-pure-functions.md) | SEO metadata from pure functions      |
| [0012](./docs/adr/0012-browser-calls-api-directly.md)  | Browser calls the API directly        |
| [0013](./docs/adr/0013-feature-based-web-structure.md) | Feature-based web structure           |
| [0014](./docs/adr/0014-native-swift-kotlin-uniffi.md)  | Native = Swift/Kotlin with UniFFI     |

Requirements marked `planned` are specified but not built yet; they are the roadmap.

## Documentation

| Doc                                        | Purpose                                     |
| :----------------------------------------- | :------------------------------------------ |
| [docs/SAMPLE_APP.md](./docs/SAMPLE_APP.md) | End-to-end walkthrough, key files           |
| [docs/API.md](./docs/API.md)               | REST endpoints, curl samples                |
| [docs/DESIGN.md](./docs/DESIGN.md)         | Token pipeline (`pnpm tokens:sync`)         |
| [docs/TESTING.md](./docs/TESTING.md)       | TDD, fixtures, coverage, E2E                |
| [docs/UI.md](./docs/UI.md)                 | Web UI structure and accessibility          |
| [docs/REVIEW.md](./docs/REVIEW.md)         | Architecture review (verified against repo) |
| [docs/ROADMAP.md](./docs/ROADMAP.md)       | Backlog and checkboxes                      |
| [AGENTS.md](./AGENTS.md)                   | Agent workflow in this template             |

---

## oRPC boundary

Full oRPC on Axum is not wired in this template. Instead:

- `@tran/api` defines an **oRPC contract** and **Zod** input/output schemas.
- Axum returns JSON that matches those schemas.
- Clients validate responses with Zod (`checkVoteEligibility` / `TranApiClient`).

This gives tRPC-like ergonomics on the TypeScript side without a Rust oRPC runtime.

---

## Commands

| Command                | Action                                                     |
| :--------------------- | :--------------------------------------------------------- |
| `pnpm dev`             | Run apps via Nx                                            |
| `pnpm dev:web`         | Vite web app                                               |
| `pnpm dev:api`         | Axum API                                                   |
| `pnpm dev:native`      | Legacy Expo client (`apps/native`)                         |
| `pnpm test`            | `cargo test` + Vitest (fast)                               |
| `pnpm test:coverage`   | Rust + TS with **100% coverage gates**                     |
| `pnpm test:e2e`        | Playwright Gherkin (starts API + web)                      |
| `pnpm test:all`        | Coverage + E2E (what CI runs for tests)                    |
| `pnpm typecheck`       | TypeScript                                                 |
| `pnpm lint`            | Clippy                                                     |
| `pnpm tokens:sync`     | Regenerate tokens → TS/CSS, Swift, Kotlin, legacy RN stub  |
| `pnpm uniffi:generate` | Regenerate Swift/Kotlin bindings from `crates/tran-uniffi` |
| `pnpm ios:build`       | Build SwiftUI app for iOS Simulator (no signing)           |
| `pnpm ios:project`     | Regenerate Xcode project from `apps/ios/project.yml`       |
| `pnpm android:build`   | Build Compose debug APK                                    |

Brand semantics: `crates/rust-core/src/tokens.rs` → `tran-tokens-codegen`. See [docs/DESIGN.md](./docs/DESIGN.md).

---

## Environment variables

See [`.env.example`](./.env.example):

- `PORT` / `HOST` — Axum bind address (default `3001`)
- `VITE_TRAN_API_URL` / `EXPO_PUBLIC_TRAN_API_URL` — client API base URL

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome on `dev`.

---

## License

MIT © [Bishal Ghimire](https://github.com/bishalg)
