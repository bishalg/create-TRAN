# Operations runbook

What to look at and what to type when the API misbehaves. It covers the reference target: one host, Docker Compose,
two API slots behind nginx, one SQLite file ([DEPLOY.md](./DEPLOY.md)). The signals are in
[OBSERVABILITY.md](./OBSERVABILITY.md), the database rules in [PERSISTENCE.md](./PERSISTENCE.md), the limits in
[RATE_LIMITING.md](./RATE_LIMITING.md). The big picture: [ARCHITECTURE.md](./ARCHITECTURE.md).

In the commands below, `<env>` is `staging` or `production`, and `<path>` is `DEPLOY_PATH` on the host (default
`tran` under the deploy user's home). Run host commands from `<path>`.

## Service facts

### The binary

The image runs one static binary, `/api` ([`apps/api/Dockerfile`](../apps/api/Dockerfile)). Its commands are parsed
in [`apps/api/src/commands.rs`](../apps/api/src/commands.rs); there are no others.

| Command                | Does                                                                                           | Exit                                                   |
| :--------------------- | :--------------------------------------------------------------------------------------------- | :----------------------------------------------------- |
| `api` (no arguments)   | Serve. Refuses to start with pending migrations outside `development` and `test`               | 1 if the server stops on an error                      |
| `api check-config`     | Validate every setting, the push keys, the rule file and the database location. Writes nothing | 2 on any problem, naming the variable, never its value |
| `api migrate`          | Apply pending migrations, each in its own transaction; create the database if missing          | 2 on failure                                           |
| `api migrate --check`  | Report pending migrations; change nothing                                                      | 1 if any are pending, 2 on any other problem           |
| `api prune`            | Delete expired sessions, token digests and stale device registrations once                     | 2 on failure                                           |
| `api send-test-push …` | Ring one device by hand ([PUSH.md](./PUSH.md))                                                 | 1 not accepted, 2 not sent                             |

Anything else exits `2` with the usage line. There is no admin HTTP API, no session-revocation command and no backup
command.

### Ports and endpoints

| What                    | Where                                                               | Notes                                                                      |
| :---------------------- | :------------------------------------------------------------------ | :------------------------------------------------------------------------- |
| API                     | `HOST:PORT`, default `0.0.0.0:3001`                                 | `.env.example` uses `127.0.0.1` for local work                             |
| Compose public port     | nginx on `PUBLIC_PORT` (8080)                                       | TLS terminates in front of it; nothing in the repo does TLS                |
| Compose slot probes     | `127.0.0.1:3101` (blue), `127.0.0.1:3102` (green)                   | loopback only, for `scripts/deploy.sh`                                     |
| Metrics                 | `GET /metrics` on `METRICS_ADDR`                                    | off unless set; never on the public router (REQ-OBS-006)                   |
| `GET /api/health`       | JSON: crate versions, uptime                                        | REQ-API-012                                                                |
| `GET /api/health/live`  | `200` while the process answers                                     | liveness probe                                                             |
| `GET /api/health/ready` | `200 {"ready":true}`; `503 server.unavailable` once shutdown starts | **does not check the database or the push providers** (`routes/health.rs`) |

The Compose file publishes no metrics port. To scrape, set `METRICS_ADDR` (for example `0.0.0.0:9090`) in the env
file and run the scraper on the Compose network, or add a loopback port in a fork.

### Metrics

From [`apps/api/src/metrics.rs`](../apps/api/src/metrics.rs). Each process has its own; during a blue/green overlap
there are two.

| Metric                               | Type      | Labels                                   |
| :----------------------------------- | :-------- | :--------------------------------------- |
| `tran_http_requests_total`           | counter   | `method`, `route`, `status`              |
| `tran_http_request_duration_seconds` | histogram | `method`, `route` (5 ms to 10 s buckets) |
| `tran_http_requests_in_flight`       | gauge     |                                          |
| `tran_rate_limited_total`            | counter   | `class` (`auth`, `write`, `read`)        |
| `tran_build_info`                    | gauge = 1 | `version`, `commit`                      |

`route` is a template from the route table, a health path, or `unmatched`. There is no metric for the database, the
migration state, readiness or push delivery.

### Logs

JSON lines on stdout outside `development` (pretty text there). Default level `api=info` outside development;
`RUST_LOG` overrides it. The events worth knowing:

| Event                                                       | Fields                                                                     | Means                                                       |
| :---------------------------------------------------------- | :------------------------------------------------------------------------- | :---------------------------------------------------------- |
| `service started`                                           | `version`, `commit`, `environment`, `listening_address`, `metrics_address` | the listeners are bound                                     |
| `request completed`                                         | `method`, `route`, `status`, `latency_ms`, `request_id`, `trace_id`        | one per request (`debug` for health probes)                 |
| `request failed`                                            | `code`, `status`, `request_id`, `trace_id`, `detail`                       | one per failure; `detail` is the fixed message or the cause |
| `rate limited`                                              | `class`                                                                    | at most once per window per key; never who                  |
| `rate limit store failed on auth route` / `…, failing open` | `class`                                                                    | the limiter broke; at most once a minute                    |
| `refresh token replayed; session revoked`                   |                                                                            | a refresh token was presented twice                         |
| `account deleted`                                           |                                                                            | the request id is the whole audit trail                     |
| `database pruned` / `database prune failed`                 | `sessions`, `tokens`, `devices` counts / the store's fixed message         | hourly, and on start                                        |
| `shutdown started`, `shutdown complete`                     |                                                                            | `SIGTERM` received; drain over                              |
| `command failed`, `server stopped`                          | `error` / `err`                                                            | a command or the server exited non-zero                     |

No log line holds a token, a header value, a body, a raw path or an installation id (REQ-SEC-014, REQ-OBS-004,
REQ-PSH-007).

### Fixed numbers

| Number                         | Value                               | Where                                                                 |
| :----------------------------- | :---------------------------------- | :-------------------------------------------------------------------- |
| Request deadline               | 4 s, then `503`                     | `SERVER_DEADLINE_MS`, `crates/rust-core/src/feedback.rs`              |
| Body limit                     | 16 KiB, then `413`                  | `Limits` in `apps/api/src/lib.rs`                                     |
| In-flight ceiling              | 100, then `503` + `Retry-After: 1`  | `RATE_MAX_IN_FLIGHT`                                                  |
| Rate limits (per minute/burst) | auth 10/5, write 60/20, read 300/60 | `RATE_LIMIT_<CLASS>`, `crates/rust-core/src/rate.rs`                  |
| Database lock wait             | 2 s, then `503`                     | `DB_POLICY.busy_timeout_ms`, `apps/api/src/db/mod.rs`                 |
| Prune interval                 | 1 hour                              | `DB_POLICY.prune_interval_seconds`                                    |
| Shutdown drain                 | 10 s                                | `SHUTDOWN_GRACE_MS`; Compose stops with `DEPLOY_GRACE_SECONDS` (30 s) |
| Rule file re-read              | at most every 300 s                 | `CONFIG_POLICY.max_age_seconds`, `crates/rust-core/src/flags.rs`      |

Every `503` (load shed, deadline, store failure, shutting down) carries the code `server.unavailable`. To tell them
apart, read `detail` on the `request failed` line.

## Suggested alerts

**These are suggestions for a fork.** The template ships no alerting backend and no rules file; the signals are
open formats so any backend can read them ([ADR-0040](./adr/0040-observability-open-formats-no-vendor.md)). Tune the
thresholds to your traffic.

| Alert                       | Condition (PromQL)                                                                                                                                                                  | Why it matters                                             | First three checks                                                                                                                                                                                                         |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error ratio (page)          | `sum by (route) (rate(tran_http_requests_total{status=~"5.."}[5m])) / sum by (route) (rate(tran_http_requests_total[5m])) > 0.01` for 5 m                                           | Users see failures                                         | 1. Which `code` on the `request failed` lines (`server.unavailable` vs `server.internal`). 2. Did a deploy just happen (`tran_build_info`, `deploy/state/<env>/history`). 3. Is it only session routes (the store, below). |
| Store failing (page)        | `sum(rate(tran_http_requests_total{status="503", route=~"/api/v1/(auth\|account\|devices).*"}[5m])) > 0` for 5 m                                                                    | Sign-in, refresh and devices fail while readiness is green | 1. `detail` says `busy` or `failed`. 2. Disk space on the volume. 3. Another process holding the lock (a migration, a backup, a manual `sqlite3`).                                                                         |
| Latency (ticket)            | `histogram_quantile(0.95, sum by (le, route) (rate(tran_http_request_duration_seconds_bucket[5m]))) > 1` for 10 m                                                                   | Slow before it fails; the deadline is 4 s                  | 1. Which route. 2. `tran_http_requests_in_flight` near the ceiling. 3. Store waits (`503` with `busy`).                                                                                                                    |
| Near the ceiling (ticket)   | `max(tran_http_requests_in_flight) > 80` for 5 m                                                                                                                                    | Load shedding starts at 100                                | 1. Traffic source by route. 2. Latency of the slowest route. 3. Whether `RATE_MAX_IN_FLIGHT` fits the host.                                                                                                                |
| Not ready (page)            | your prober's result for `/api/health/ready` failing longer than a deploy takes (for example Prometheus blackbox `probe_success == 0` for 2 m), or `up == 0` for the metrics target | Nothing serves                                             | 1. `docker ps` on the host: which slot runs. 2. The slot's last log lines (`server stopped`, `command failed`). 3. `deploy/state/<env>/active-slot` matches the running slot.                                              |
| Rate limiting (ticket)      | `sum by (class) (rate(tran_rate_limited_total[5m])) / scalar(sum(rate(tran_http_requests_total[5m]))) > 0.05` for 10 m                                                              | Either an attack or legitimate users being refused         | 1. `TRUSTED_PROXIES` (everyone behind one proxy counts as one address). 2. Which class. 3. Whether a client retries in a loop (one version in `X-Tran-Client` logs).                                                       |
| Refresh rejections (ticket) | `sum(rate(tran_http_requests_total{route="/api/v1/auth/refresh", status="401"}[10m]))` well above its usual rate                                                                    | A client bug signs people out, or tokens are replayed      | 1. `refresh token replayed` lines. 2. A client release that refreshes in parallel. 3. A recent restore or session revocation.                                                                                              |
| Migration failure (page)    | no metric exists: alert on the deploy job failing, or on a `command failed` log line from a `migrate` run                                                                           | The new release cannot start; the old one keeps serving    | 1. The error text (table below). 2. `api migrate --check` with the new image. 3. Whether a later file in the same release already applied.                                                                                 |
| Wrong version (ticket)      | `count(count by (version) (tran_build_info)) > 1` for 15 m                                                                                                                          | A deploy left two versions serving                         | 1. `docker ps`. 2. `deploy/state/<env>/history`. 3. The proxy's `active.conf`.                                                                                                                                             |

## Incident procedures

### Bad deploy: roll back

A rollback is deploying the previous digest ([DEPLOY.md](./DEPLOY.md), REQ-DEP-006). Read the limit at step 2 first.

1. Find the previous image: `cat deploy/state/<env>/previous`, and `tail deploy/state/<env>/history`.
2. Check the migrations. If the bad release added a migration that already ran, **the previous image will refuse the
   database**: the runner rejects a database holding a migration it does not know (`MigrationError::Unknown`,
   REQ-DB-002), so the rollback stops at its `migrate` step and the bad release keeps serving. Then fix forward with a
   new release. Also stop if the deploy printed `warning: rollback past … is not supported once applied`.
3. Preferred route: GitHub Actions → Deploy → run with `image_digest` = the `sha256:…` part of the previous
   reference. This logs the host in to the registry and goes through the `production` approval.
4. On the host instead: `scripts/deploy.sh <env> --rollback`. The script pulls first, so a private registry needs
   `docker login ghcr.io` on the host, or it stops with `could not pull … nothing was changed`.
5. Confirm: `/api/health/ready` through the proxy, `tran_build_info{version=…}`, and the `service started` line.
6. Note: `--rollback` swaps `current` and `previous`. Running it twice deploys the bad image again.

### Failed migration at start-up

1. Read the error. The runner says what is wrong ([`apps/api/src/db/migrate.rs`](../apps/api/src/db/migrate.rs)):

   | Message says                                       | Do                                                                                       |
   | :------------------------------------------------- | :--------------------------------------------------------------------------------------- |
   | `N migration(s) pending; run api migrate`          | Run the migrate step; the server never migrates outside development (REQ-DB-003)         |
   | `was changed after it was applied (checksum …)`    | A shipped migration file was edited. Restore it; fix forward with a new file             |
   | `which this build does not know`                   | The database is newer than this binary. Deploy the newer version                         |
   | `failed and was rolled back` / `foreign key check` | That file's transaction was rolled back; earlier files in the same run stay applied      |
   | `there is no database where DATABASE_URL points`   | Wrong `DATABASE_URL`, or the volume is not mounted; `api migrate` creates one on purpose |

2. Inspect without changing anything, with the image that failed:

   ```sh
   docker run --rm --read-only --user 10001:10001 \
     --env-file deploy/state/<env>/app.env \
     -v tran-<env>_data:/data <image@sha256:…> migrate --check
   ```

3. During `scripts/deploy.sh` a failed migrate stops before the new slot starts; the old slot keeps serving. Do not
   restart the old slot if any file of the new release applied: it would refuse the newer database (step 2 above).
4. Fix forward: a new migration file, a new release, a new deploy.

### Store unavailable or disk full

Symptoms: `503 server.unavailable` on `/api/v1/auth/*`, `/api/v1/account` and `/api/v1/devices/*`, with `detail`
`the database is busy` or `the database failed`; read-only routes still `200`; readiness still `200`.

1. Disk: `df -h "$(docker volume inspect tran-<env>_data --format '{{ .Mountpoint }}')"`. Look at the size of
   `api.sqlite3-wal` next to `api.sqlite3`; a WAL that keeps growing means checkpoints are starved by a long reader.
2. Locks: anything else with the file open (`lsof` on the volume path)? A backup, a manual `sqlite3`, a stuck
   migration. Each request waits at most 2 s for the lock, then answers `503`.
3. Free space, then run `api prune` once with the same `docker run` line as above (`prune` instead of
   `migrate --check`). It logs how many rows went.
4. `detail` never carries SQLite's own message, by design. If `failed` persists with free disk and no lock, check
   the file: `sqlite3 <file> 'PRAGMA integrity_check'`. Anything but `ok`: restore from backup (below).

### Rate limiter refusing legitimate users

1. Confirm: `tran_rate_limited_total{class=…}` rising and users reporting "Too many requests".
2. Check `TRUSTED_PROXIES` in the env file. Unset, every request counts by the socket peer, which behind nginx is the
   proxy: everyone shares one bucket. Set it to the Compose network's subnet and to the load balancer's addresses
   ([RATE_LIMITING.md](./RATE_LIMITING.md)).
3. If the limits are simply too low: raise `RATE_LIMIT_<CLASS>=<per minute>/<burst>` in the env file, run
   `api check-config`, then redeploy the current digest (`scripts/deploy.sh <env> "$(cat deploy/state/<env>/current)"`)
   so the new slot starts with it. Settings are read only at start.
4. Each process keeps its own buckets, so a restart forgets them; it is not a fix.

### Mass sign-out or session revocation

There is no command or route for this. What exists:

- **One person's sessions:** `DELETE /api/v1/account` revokes every session and device registration of the caller
  (REQ-ACC-002), and erases the account.
- **One session:** sign-out (REQ-SEC-011), or a replayed refresh token, which ends the whole session (REQ-SEC-010).
- **Everyone (manual, at your own risk):** with `sqlite3` on the host, as root or uid 10001, against the live file
  (WAL lets the API keep running):

  ```sql
  PRAGMA foreign_keys = ON;   -- the sqlite3 shell starts with it off; token rows cascade only with it on
  BEGIN IMMEDIATE;
  DELETE FROM device_registrations;
  DELETE FROM sessions;
  COMMIT;
  ```

  Every access token then answers `401`, every refresh is rejected, and clients sign out (`session_recovery`,
  `crates/rust-core/src/session.rs`). Take a backup first. A fork should turn this into a tested `api` command.

### A leaked secret

Follow [SECURITY.md](./SECURITY.md): **revoke first, then remove.** Rewriting git history does not un-leak it.

1. Revoke at the issuer: the APNs key (`APNS_KEY_P8`), the FCM service account (`FCM_SERVICE_ACCOUNT_JSON`), the
   deploy SSH key (`DEPLOY_SSH_KEY`), a store or signing credential ([MOBILE_RELEASE.md](./MOBILE_RELEASE.md)).
2. Issue a new one and put it where it lives: the host's `deploy/state/<env>/app.env` for API secrets, the GitHub
   environment for deploy and release secrets. Never in the repository.
3. API secrets: `api check-config`, then redeploy the current digest so a fresh slot reads the new env file.
4. Sessions use opaque random tokens, not a signing key ([ADR-0039](./adr/0039-sessions-tokens-and-secret-storage.md)):
   there is no session key to rotate. If the database itself leaked, revoke every session (above); it holds token
   digests, not tokens, but it does hold push tokens and user ids.
5. If a secret reached git: `pnpm secrets:check` should have stopped it; find out why it did not.

### A bad flag: the kill switch

([REMOTE_CONFIG.md](./REMOTE_CONFIG.md), REQ-CFG-007)

1. Edit the rule file named by `REMOTE_CONFIG_PATH`: set the flag's rule `value` to the safe value, or remove its
   rules so it falls back to its compiled default. Deleting the file also means "every flag is its default".
2. The API re-reads the file at most every 300 s; no restart, no deploy. A file that does not parse leaves the last
   good rules in force and logs once: check the log after the edit.
3. Apps hide the feature on their next fetch; only `live` flags change inside a running app.
4. The reference Compose target mounts no rule file. A fork that wants this switch adds a read-only mount of a host
   file and points `REMOTE_CONFIG_PATH` at it.

### Forcing old clients to update

([API_VERSIONING.md](./API_VERSIONING.md), REQ-VER-005, REQ-VER-006)

1. Prefer the nudge: set `CLIENT_RECOMMENDED_VERSION_<IOS|ANDROID|WEB>`. Those clients get
   `X-Tran-Update: recommended` and a prompt they can dismiss.
2. To block: set `CLIENT_MIN_VERSION_<PLATFORM>`. Below it every product route answers `426 client.upgrade_required`
   and the app shows a blocking update screen. Health routes are not affected.
3. Only after the new version is live in that platform's store. Then `api check-config` and redeploy the current
   digest; the thresholds are read at start.

## Backup and restore

**What the repo provides today: nothing for backups.** There is no backup command, schedule or script; the
playbooks say a fork adds them ([DEPLOY.md](./DEPLOY.md), [PERSISTENCE.md](./PERSISTENCE.md),
[ADR-0049](./adr/0049-sqlite-first-forward-only-migrations.md)).

What you are backing up: one SQLite file, `/data/api.sqlite3` in the `tran-<env>_data` volume (the image's working
directory is `/`, so the default `data/api.sqlite3` lands there). It runs in WAL mode with `synchronous=NORMAL`, so
recent commits may sit in `api.sqlite3-wal`. It holds token digests, user ids and push tokens: encrypt the copies
and limit who can read them.

### A safe procedure for a fork

1. **Never copy the `.sqlite3` file alone while the API runs.** Committed data may still be in the `-wal` file, and
   copying the three files one by one is not atomic.
2. Take a consistent snapshot with SQLite itself, from a process that can open the file read-write (a WAL reader
   needs the `-shm` file), for example `sqlite3` on the host as root:

   ```sh
   DB="$(docker volume inspect tran-<env>_data --format '{{ .Mountpoint }}')/api.sqlite3"
   sqlite3 "$DB" "VACUUM INTO '/backups/api-$(date -u +%Y%m%dT%H%M%SZ).sqlite3'"
   ```

   `VACUUM INTO` reads one transaction's view, includes what is in the WAL, and writes a compact file. `.backup` in
   the `sqlite3` shell (the online backup API) is the alternative. Both are readers, so the API keeps writing; a
   very long backup only delays checkpoints.

3. Check the copy: `sqlite3 <copy> 'PRAGMA integrity_check'` says `ok`, and `PRAGMA foreign_key_check` prints nothing.
4. Encrypt it and move it off the host. Keep the image digest that was serving next to it: a backup belongs to a
   schema version.
5. Back up before every `migrate` step in a fork's deploy, and on a schedule.

### Restore

1. Stop both API slots (`docker ps --filter label=com.docker.compose.project=tran-<env>`, then `docker stop` each
   `api-*` container). The proxy can stay up; it answers with an nginx error page meanwhile.
2. In the volume, move `api.sqlite3`, `api.sqlite3-wal` and `api.sqlite3-shm` aside. Never leave an old `-wal` next to
   a restored file.
3. Copy the backup in as `api.sqlite3`, owned by `10001:10001`, mode `0600`.
4. Check the schema against the image you will run: `migrate --check` with the `docker run` line above. Older
   backup: run `migrate`. Backup from a newer release: deploy that release instead.
5. Start the slot named in `deploy/state/<env>/active-slot` (`docker start`) and wait for `/api/health/ready`.
6. Decide what the restore brought back. Sessions signed out, replayed or deleted after the backup are valid again,
   and so are accounts deleted after it. Revoke every session (above), and re-apply account deletions made since the
   backup time.

### Restore drill checklist

- [ ] A backup from the last 24 hours exists off the host, encrypted, with the image digest it belongs to.
- [ ] It restores on a scratch host or volume, not production.
- [ ] `PRAGMA integrity_check` is `ok`; `api migrate --check` with the current image passes or migrates cleanly.
- [ ] The API starts on it and `/api/health/ready` answers `200`.
- [ ] A sign-in, a refresh and a device registration work against it.
- [ ] Time from "start" to "ready" is written down and fits the recovery time you promised.
- [ ] The steps above were followed as written; any step that was wrong is fixed in this file.

## Gaps

Not built in the template. Each could become a requirement:

- Rollback across a release that added a migration: the previous image refuses the newer database (REQ-DB-002), which
  contradicts REQ-DEP-006 and ADR-0051 point 4 as written.
- A backup command, a schedule, an off-host copy, encryption at rest and a tested restore.
- A session-revocation command (all sessions, or one user's without deleting the account).
- Readiness that reflects the database; a metric for store failures, migration state or push delivery.
- An alerting backend or a shipped rules file; a log shipper; span export.
- A rule-file mount for the kill switch in `deploy/compose.yaml`.
- A published metrics port or scraper in the Compose target.
- TLS termination and a load balancer in front of nginx.
- A shared rate-limit store and a network database for more than one host.
- Reloading limits or client thresholds without a restart.
