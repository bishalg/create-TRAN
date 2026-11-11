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

`apps/api/Dockerfile` MUST be a multi-stage build whose base images are pinned by digest with the tag as a comment,
build with `--locked`, and produce a runtime image that contains the binary and its migrations, runs as a non-root
user, has no shell or package manager, and starts with a read-only root filesystem. The version and commit MUST be
build arguments that reach `tran_build_info` and the start-up event (REQ-OBS-009). `pnpm supply:check` MUST fail on a
base image without a digest.
**Verified by:** `tooling/deploy/deploy.test.mjs`, `tooling/supply-chain/supply-chain.test.mjs`.

### REQ-DEP-002 [verified] The image holds no configuration and no secret

Everything that differs between environments MUST come from the environment at run time (`.env.example` is the list).
The Dockerfile MUST NOT set a secret-like `ARG` or `ENV`, and `.dockerignore` MUST exclude `.env*`, `data/`, signing
material and the repository's `.git`. `pnpm secrets:check` MUST cover both files.
**Verified by:** `tooling/secrets/secrets.test.mjs`, `deploy.test.mjs`.

### REQ-DEP-003 [verified] Configuration is validated before anything rolls out

`api check-config` MUST load the configuration exactly as the server does and exit non-zero, naming the variable and
never its value, when anything is missing or malformed for the given `APP_ENV` (for example no `CORS_ALLOWED_ORIGINS`,
or a database path that cannot be opened, outside development). The pipeline MUST run it against the target
environment's configuration before migrating.
**Verified by:** `apps/api/tests/check_config_test.rs`.

### REQ-DEP-004 [verified] The image is built once and promoted by digest

A pushed version tag MUST build the image once, with an SBOM and a provenance attestation, and publish it to the
registry. Staging and production MUST deploy that digest; no job may rebuild for an environment. The workflow MUST pin
its actions (REQ-SUP-003) and MUST skip publishing with a notice when the registry credentials are absent.
**Verified by:** `deploy.test.mjs` (workflow structure).

### REQ-DEP-005 [verified] A deploy runs its steps in one order

`scripts/deploy.sh <environment> <image digest>` MUST: validate the configuration (REQ-DEP-003); run `api migrate`
once with the new image (REQ-DB-003); start the new version; wait for `GET /api/health/ready` to succeed within a
deadline; only then stop the previous version with `SIGTERM` and wait for it to drain (REQ-OBS-008). If any step
fails, it MUST leave the previous version serving and exit non-zero. The script drives a `Target` it is given (the
sample's is Docker Compose on one host), so the order is tested without a cloud.
**Verified by:** `tooling/deploy/deploy.test.mjs` with a fake target that records the calls; `pnpm deploy:smoke`.

### REQ-DEP-006 [verified] A rollback is the same deploy with the previous digest

`scripts/deploy.sh <environment> <previous digest>` MUST work without a schema change, because every migration keeps
the previous release's code working (REQ-DB-005). The pipeline MUST record the digest each environment runs, so
"previous" is a fact, not a memory. A migration marked `-- contract:` MUST name the release after which rollback past
it is no longer possible, and the deploy output MUST print that warning.
**Verified by:** `deploy.test.mjs`; `pnpm deploy:smoke` deploys, rolls back and checks the API still serves.

### REQ-DEP-007 [verified] The image is proven by running it

`pnpm deploy:smoke` MUST build the image, start it with a read-only root filesystem and a non-root user, wait for
readiness, sign in and call a product route, send `SIGTERM`, and require an exit code of `0` within the grace period.
It MUST be skipped with an allowlisted reason when no container runtime is installed, and MUST run in CI.
**Verified by:** `e2e/smoke/image.spec.ts`.

### REQ-DEP-008 [verified] Production deploys are deliberate and gated

`.github/workflows/deploy.yml` MUST deploy staging automatically from a version tag and production only by manual
dispatch through a protected GitHub environment, with credentials only from that environment's secrets, never on a
pull request. With no deploy target configured it MUST skip with a notice; the test that would deploy to a real host
is skipped with a `TODO(credentials)` marker (REQ-CODE-005).
**Verified by:** `deploy.test.mjs`; `pnpm todos:check`.

### REQ-DEP-009 [verified] The web app is published with its headers and cache rules

The web build MUST be publishable as static files with a committed header configuration (`deploy/web/`): hashed assets
cached immutably; `index.html` and `account-deletion.html` revalidated on every load; and the response headers the
page cannot set for itself (`Content-Security-Policy` with `frame-ancestors 'none'`, `Strict-Transport-Security`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` denying what the app does not use). A test MUST fail
when the header file's CSP is weaker than the one the build puts in the page (REQ-SEC-024).
**Verified by:** `apps/web/tests/deploy-headers.test.ts`.

### REQ-DEP-010 [planned] Image size and start-up time are budgeted

The compressed image size and the time from process start to ready MUST be measured by `pnpm metrics` and held to a
budget in the committed report (ADR-0031).
**Verified by:** `tooling/metrics` tests; `docs/reports/`.
