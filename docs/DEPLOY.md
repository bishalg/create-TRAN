# Deploy playbook

What it is: turning the API into one container image and moving it to servers, and publishing the web app. Why it is
here: the costly release mistakes are in the order of steps and in what the image contains, and they are the same on
every platform. Rules: [spec 032](./specs/032-deploy-pipeline.md). Reasons:
[ADR-0051](./adr/0051-build-once-migrate-then-roll.md). Mobile: [MOBILE_RELEASE.md](./MOBILE_RELEASE.md).

## The rules

1. **Build once.** The image from the version tag is the one every environment runs. Deploy by digest, never rebuild.
2. **Nothing environment-specific in the image.** No `ENV`, no secrets, no URLs. Configuration comes from the target's
   env file on the host.
3. **Small and locked down.** Pinned base images, a static binary on `scratch`, no shell, uid 10001, read-only root.
4. **One order:** check config → migrate → start new → wait for ready → switch → drain old.
5. **Never send traffic before ready, never kill without draining.** A failed step leaves the old version serving.
6. **Rollback is redeploying the previous digest.** It works because migrations keep the previous version running
   ([PERSISTENCE.md](./PERSISTENCE.md)). Know your one-way doors: `-- contract:` migrations.
7. **Production is a manual, approved step** with the digest staging ran. Staging follows the tag.
8. **Prove the image by running it** (`pnpm deploy:smoke`), not by reading the Dockerfile.

## A release

```
pnpm release auto → tag vX.Y.Z → push            version, changelog (spec 017)
CI: image smoke, then build once (SBOM, provenance) → ghcr.io/<owner>/<repo>/api@sha256:…
staging (automatic):   deploy/remote.sh staging <image@digest>   → scripts/deploy.sh on the host
test staging
production (manual):   Actions → Deploy → image_digest = sha256:…   approved in the `production` environment
bad?                   ssh host: scripts/deploy.sh production --rollback
```

## The image

`apps/api/Dockerfile`, built from the repository root. The builder is the Rust the repo builds with (pinned by digest);
`pnpm supply:check` fails when it is older than any locked dependency's `rust-version`. The runtime is `scratch` with
the static musl binary, `/etc/passwd` and `/etc/group` for uid 10001, and `/data` owned by it, so a new named volume
starts writable. Migrations are embedded in the binary; TLS roots are compiled in (webpki-roots), so no CA bundle.
`VERSION` (checked against the workspace version) and `COMMIT` are build arguments only. The context is an allow-list
in the root `.dockerignore`; `pnpm secrets:check` proves keys, env files and data stay out at any depth.

## The Compose target

`deploy/compose.yaml` on one host: two API slots, `api-blue` and `api-green`, on one SQLite file in WAL mode (two
processes may share it during the overlap), each publishing only on `127.0.0.1` for the readiness probe, and an nginx
proxy that owns the public port. `scripts/deploy.sh <environment> <image@digest>`:

1. pulls the image and runs `check-config` with it and the target's env file;
2. runs `migrate` once with it;
3. starts it in the inactive slot and probes that slot's `/api/health/ready` until the deadline; on failure it removes
   the new slot and exits non-zero, the old slot untouched;
4. writes the proxy's `active.conf` and reloads nginx (new connections go to the new slot, old workers finish), then
   stops the old slot with `SIGTERM` and the grace period;
5. records `current`, `previous`, `active-slot` and a `history` line in `deploy/state/<environment>/` on the host.

Why nginx: it is the smallest proxy that can switch upstream without dropping connections (`nginx -s reload`), its
image is pinned by digest, and the repo already uses its syntax for the web headers. The upstream is resolved per
request through Docker's DNS, so the proxy starts whichever slot is up. TLS terminates in front of it; set
`TRUSTED_PROXIES` in the env file to the Compose network's subnet ([RATE_LIMITING.md](./RATE_LIMITING.md)).

On the host, once: install Docker with the Compose plugin, create the deploy user, and put the API's configuration in
`<DEPLOY_PATH>/deploy/state/<environment>/app.env` (or point `DEPLOY_ENV_FILE` at it). Optional: `PUBLIC_PORT`
(8080), `API_BLUE_PORT`/`API_GREEN_PORT` (3101/3102), `DEPLOY_READY_TIMEOUT` (60 s), `DEPLOY_GRACE_SECONDS` (30 s).

## The pipeline

`.github/workflows/deploy.yml`. Off until the repository variable `DEPLOY_ENABLED` is `true`
([CREDENTIALS.md](./CREDENTIALS.md)); until then a tag still runs the image smoke and builds, and a notice says nothing
was published or deployed. Each GitHub environment (`staging`, `production`, the latter with required reviewers)
holds `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS` (variables), optional `DEPLOY_USER` and `DEPLOY_PATH`, and `DEPLOY_SSH_KEY`
(secret). `deploy/remote.sh` ships the script, the Compose target and the migrations to the host, logs the host in to
the registry with the job's short-lived token over stdin, runs the deploy there and logs out. Host keys are checked
strictly against `DEPLOY_KNOWN_HOSTS`, never accepted on first use. Each deploy job has its own least permissions and
a per-environment concurrency group that never cancels a deploy in progress.

## The web headers

`deploy/web/_headers` (Netlify, Cloudflare Pages) and `deploy/web/headers.conf` (nginx) say the same thing for every
path: security headers everywhere (on errors too, `always`), hashed assets immutable, HTML revalidated. The header
`Content-Security-Policy` carries only `frame-ancestors 'none'`, which a `<meta>` policy cannot express, plus
`object-src`, `base-uri` and `form-action` exactly as the page's own policy has them. Why not generate the full policy
into the header: browsers enforce both policies, the page's one already holds the inline-script hashes and the API
origin of its build, and a header copy would have to be regenerated per build and per API URL; a header that only
adds what the page cannot say cannot drift into blocking it. `apps/web/tests/deploy-headers.test.ts` enforces it.

## Where it lives

| Part                              | Place                                                             |
| :-------------------------------- | :---------------------------------------------------------------- |
| Image                             | `apps/api/Dockerfile`, `.dockerignore`                            |
| Deploy order and reference target | `scripts/deploy.sh`, `deploy/compose.yaml`, `deploy/proxy/`       |
| Reaching the host                 | `deploy/remote.sh`                                                |
| Config validation                 | `api check-config` (`cargo run -p api -- check-config`)           |
| Pipeline                          | `.github/workflows/deploy.yml`, `.github/workflows/image.yml`     |
| Web headers and cache rules       | `deploy/web/`                                                     |
| Tests                             | `pnpm deploy:check` (fake docker, curl, ssh), `pnpm deploy:smoke` |

## What a fork adds

- **Its target:** replace the Compose branch of `scripts/deploy.sh` with its platform's commands; keep the order, the
  readiness gate and the tests' fake executables.
- **Registry and host credentials** in the protected GitHub environments ([CREDENTIALS.md](./CREDENTIALS.md)).
- **A network database** before running more than one host.
- **TLS and a load balancer** in front of the proxy, with `TRUSTED_PROXIES` set.
- **Backups before each migration** and a restore drill.
- **Alerts** on the deploy: error rate and readiness, from [OBSERVABILITY.md](./OBSERVABILITY.md).
