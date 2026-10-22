# 017 Release and versioning

Scope: how this repo, and a project scaffolded from it, gets from commits to a tagged, tested release with notes:
one version for every platform, conventional commits, a changelog written from history and a release workflow.
Rationale: [ADR-0034](../adr/0034-release-and-versioning.md).

### REQ-REL-001 [verified] One version everywhere

The root `package.json` `version` MUST be the only place a version is chosen. Every workspace `package.json`, the
Cargo `[workspace.package]` version and the workspace crates in `Cargo.lock`, iOS `MARKETING_VERSION` and Android `versionName` MUST equal it, and the build
numbers (iOS `CURRENT_PROJECT_VERSION`, Android `versionCode`) MUST equal `major × 1,000,000 + minor × 1,000 + patch`,
so they increase with every release. `pnpm release:check` MUST fail on any mismatch and CI MUST run it. The
scaffolding CLI MUST report its own package version, not a copy.
**Verified by:** `tooling/release/release.test.mjs`.

### REQ-REL-002 [verified] Commit messages follow Conventional Commits

The `commit-msg` hook MUST reject a commit whose header is not `type(scope)!: subject`, with `type` one of `feat`,
`fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style` or `revert`; the scope and `!` are
optional. Merge, revert, `fixup!` and `squash!` commits MUST pass.
**Verified by:** `tooling/release/release.test.mjs`.

### REQ-REL-003 [verified] The version and changelog come from history

`pnpm release <auto|patch|minor|major>` MUST compute the next version from the commits since the last `v*` tag
(`auto`: a breaking change bumps major, or minor while the major is 0; a `feat` bumps minor; anything else patch),
write it to every file in REQ-REL-001, and prepend a `CHANGELOG.md` section listing breaking changes, features, fixes,
performance and other changes. It MUST refuse a dirty working tree or a range with no commits, and MUST NOT tag or
push: it prints the commands for a person to run.
**Verified by:** `tooling/release/release.test.mjs`.

### REQ-REL-004 [verified] A version tag produces a tested release

Pushing a `v*` tag MUST run `.github/workflows/release.yml`, which fails unless the tag equals the version, runs the
Rust and TypeScript tests, builds the web app and the Android release APK, and creates a GitHub release whose notes
are that version's `CHANGELOG.md` section, with the web build and the APK attached. Every action MUST be pinned. A manual run MUST be a dry run of the current version: the same checks and builds, the files kept as workflow
artifacts, and nothing published.
**Verified by:** `tooling/release/release.test.mjs` (workflow shape).

### REQ-REL-005 [verified] A new project starts at 0.1.0 with its own changelog

`create-tran` MUST set every version in REQ-REL-001 to `0.1.0` and replace `CHANGELOG.md` with an empty one, so a
project does not inherit the template's version or history.
**Verified by:** the scaffold smoke test in `packages/create-tran/tests/scaffold-smoke.test.ts`.
