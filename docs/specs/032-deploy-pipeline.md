# 032 Container image and deploy pipeline

Scope: how the Axum API (`apps/api`) becomes one container image, how that image moves unchanged from build to
staging to production, in what order a deploy does its steps, how a bad deploy is undone, and how the web app
(`apps/web`) is published with the response headers it needs. Mobile delivery is [025](025-mobile-release.md). Builds
on [016](016-supply-chain.md) (pinned actions), [017](017-release.md) (releases from tags), [023](023-observability.md)
(readiness, graceful shutdown), [030](030-persistence-and-migrations.md) (migrate, then serve) and
[019](019-code-health.md) (credential-gated code). Rationale: [ADR-0051](../adr/0051-build-once-migrate-then-roll.md).
Playbook: [`../DEPLOY.md`](../DEPLOY.md).

Vocabulary used below:

- An **image digest** is the content hash of one built image. Deploying "the same build" means deploying the same
  digest, not the same tag.
- **Promote**: deploy to the next environment the digest that was tested in the previous one.
- A **rollback** is deploying the previous digest again. It is safe only because migrations keep the previous version
  working (REQ-DB-005).

### REQ-DEP-001 [verified] The API is one small, reproducible, non-root image

`apps/api/Dockerfile` MUST be a multi-stage build whose base images are pinned by digest, with a builder Rust not older
than the newest `rust-version` among the API's locked dependencies, built with `--locked` from an allow-listed
context that holds everything the workspace build reads. The runtime image MUST contain only the static binary (its
migrations are embedded) and a user and group, run as uid 10001, have no shell or package manager, and start with a
read-only root filesystem and a writable `/data` volume. The version and commit MUST be build arguments; the commit
reaches the start-up event and `tran_build_info` (REQ-OBS-009). `pnpm supply:check` MUST fail on a base image without
a digest and on a builder Rust that is too old.
**Verified by:** `e2e/smoke/image.spec.ts` (builds and runs it), `tooling/supply-chain/supply-chain.test.mjs`,
`tooling/deploy/target.test.mjs`.

### REQ-DEP-002 [verified] The image holds no configuration and no secret

Everything that differs between environments MUST come from the environment at run time (`.env.example` is the list);
the image sets no `ENV`. The Dockerfile MUST NOT set a secret-like `ARG` or `ENV`, and `.dockerignore` (the build
context is the repository root, so the root file is the one that applies) MUST keep `.env*`, `data/`, signing material
and `.git` out of the context at any depth. `pnpm secrets:check` MUST cover both files.
**Verified by:** `tooling/secrets/secrets.test.mjs`, `e2e/smoke/image.spec.ts`, `tooling/deploy/target.test.mjs`.

### REQ-DEP-003 [verified] Configuration is validated before anything rolls out

`api check-config` MUST load the configuration exactly as the server does and exit non-zero, naming the variable and
never its value, when anything is missing or malformed for the given `APP_ENV` (for example no `CORS_ALLOWED_ORIGINS`,
or a database path that cannot be opened, outside development). The deploy MUST run it with the new image against the
target's env file before migrating.
**Verified by:** `apps/api/tests/check_config_test.rs`, `e2e/smoke/image.spec.ts` (in the image),
`tooling/deploy/deploy-script.test.mjs` (before migrate).

### REQ-DEP-004 [verified] The image is built once and promoted by digest

A pushed version tag MUST build the image once, with an SBOM and a provenance attestation, after the image smoke
(REQ-DEP-007) passed, and publish it. Staging MUST deploy that build's full reference by digest; production MUST take
a digest as input and depend on no build job. The workflow MUST pin its actions (REQ-SUP-003). Publishing and deploying
are switched on by the repository variable `DEPLOY_ENABLED`; when it is off the workflow still builds, publishes
nothing and says so in a notice.
**Verified by:** `tooling/deploy/workflow.test.mjs` (the parsed job graph; a real publish needs `DEPLOY_ENABLED`).

### REQ-DEP-005 [verified] A deploy runs its steps in one order

`scripts/deploy.sh <environment> <registry/name@sha256:…>` MUST, on the target host: check the configuration with the
new image (REQ-DEP-003); run `api migrate` once with the new image (REQ-DB-003); start the new image in the inactive
slot; wait for that slot's `GET /api/health/ready` within a deadline; only then switch the proxy to it and stop the
previous slot with `SIGTERM` and its grace period (REQ-OBS-008). If any step before the switch fails, it MUST remove
the new slot, leave the previous version serving and exit non-zero. It MUST refuse a bare digest, a tag, a missing env
file and an unknown target. The image reference is fixed once and used by every step; nothing in the script or the
Compose target is specific to an environment.
**Verified by:** `tooling/deploy/deploy-script.test.mjs` (the real Compose branch against fake `docker` and `curl`),
`tooling/deploy/target.test.mjs`.

### REQ-DEP-006 [verified] A rollback is the same deploy with the previous digest

`scripts/deploy.sh <environment> --rollback` (or the previous reference by hand) MUST run the same steps with the
previous image and work without a schema change, because every migration keeps the previous release's code working
(REQ-DB-005). The script MUST record, on the host, the image each environment runs and the one before it, so
"previous" is a fact, not a memory. A migration marked `-- contract:` MUST name the release after which rollback past
it is no longer possible, and the deploy output MUST print that warning.
**Verified by:** `tooling/deploy/deploy-script.test.mjs`.

### REQ-DEP-007 [verified] The image is proven by running it

`pnpm deploy:smoke` (its own Playwright config) MUST build the image and run it as the Compose target does: read-only
root, the image's own non-root user, a named volume, configuration only from the environment. `check-config` and
`migrate` run as their own containers; the server must become ready, sign a user in, answer product routes, and exit
`0` on `SIGTERM` within the grace period. It MUST be skipped with an allowlisted reason only when no container runtime
is available, never in CI, and MUST run in CI (`.github/workflows/image.yml`, also before every tag's build).
**Verified by:** `e2e/smoke/image.spec.ts`, `tooling/deploy/workflow.test.mjs`.

### REQ-DEP-008 [verified] Production deploys are deliberate and gated

`.github/workflows/deploy.yml` MUST deploy staging automatically from a version tag and production only by manual
dispatch through the protected `production` environment, never on a pull request, one deploy per environment at a
time and never cancelled half way. Each job MUST have only the permissions it uses, and expressions MUST reach scripts
through `env:`, never expanded inside `run:`. Deploys MUST run on the host over SSH with strict host-key checking
against configured known hosts, with credentials only from the environment's variables and secrets. With deploy off
it MUST skip with a notice; the test that deploys to a real host is skipped with a `TODO(credentials)` marker
(REQ-CODE-005).
**Verified by:** `tooling/deploy/workflow.test.mjs`, `tooling/deploy/remote.test.mjs` (fake `ssh`); `pnpm todos:check`.

### REQ-DEP-009 [verified] The web app is published with its headers and cache rules

The web build MUST be publishable as static files with committed header configurations (`deploy/web/_headers` and the
nginx `headers.conf`) that agree with each other for every path, deep links included: hashed assets cached
immutably; the HTML entry points revalidated on every load; and the response headers the page cannot set for itself
(`Content-Security-Policy` with `frame-ancestors 'none'`, `Strict-Transport-Security`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy` denying what the app does not use), on error answers too. The header policy
MUST carry no directive that could block the page and repeat any shared directive exactly as the page's own `<meta>`
policy has it, so it can neither weaken nor break it (REQ-SEC-024).
**Verified by:** `apps/web/tests/deploy-headers.test.ts`.

### REQ-DEP-010 [planned] Image size and start-up time are budgeted

The compressed image size and the time from process start to ready MUST be measured by `pnpm metrics` and held to a
budget in the committed report (ADR-0031). Missing: `tooling/metrics` does not measure the image yet; the smoke test
only records the size as an annotation.
**Verified by:** `tooling/metrics` tests; `docs/reports/`.
