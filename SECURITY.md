# Security

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/bishalg/create-TRAN/security/advisories/new) for
anything you believe is a security problem in this template or in a project scaffolded from it. Do not open a public
issue. You will get an acknowledgement within 7 days and a fix or a decision within 90 days.

## What this template ships

The sample app has demo accounts (choosing a role signs in, with no password) and no personal data. Its API issues
real sessions: opaque, rotating tokens stored as digests, a refresh token kept in an `HttpOnly` cookie or the
platform's vault, and replay detection. How secrets, tokens and sensitive data are handled, and what a fork must add,
is in [docs/SECURITY.md](docs/SECURITY.md) ([spec 022](docs/specs/022-security.md), ADR-0039). The measures below are
about the supply chain and the defaults a fork inherits (ADR-0033, [spec 016](docs/specs/016-supply-chain.md)):

- **Known vulnerabilities fail CI.** `pnpm audit` and `cargo audit` run on every push and pull request at
  `high` severity and above; the `dependency-audit` agent task can propose the fix.
- **Lockfiles are frozen** in CI (`pnpm install --frozen-lockfile`, `Cargo.lock` committed). Dependency build scripts
  run only when allowed in `pnpm-workspace.yaml`.
- **Every GitHub Action is pinned to a commit SHA**, with the version as a comment, and Dependabot keeps the pins fresh.
- **Transitive fixes are explicit:** an advisory that upstream has not bumped yet is overridden in
  `pnpm-workspace.yaml` with the vulnerable range as the key, so the override expires on its own.
- **Agents never edit manifests, lockfiles, CI or rules files** unless a task allows it; the guard job enforces this on
  every agent pull request (`.agents/policy.json`).
- **The API defaults are safe:** debug headers are gated by `APP_ENV`, CORS origins come from
  `CORS_ALLOWED_ORIGINS`, every response carries security headers, every request has a deadline and a request id,
  and panics become error responses (spec 002, spec 012, spec 022).

## Supported versions

Only the `dev` branch and the latest release tag receive fixes. A scaffolded project owns its own copy: enable
Dependabot and private vulnerability reporting in its repository settings.
