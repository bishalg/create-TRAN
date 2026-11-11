# The API image (spec 032, ADR-0051). Build from the repository root:
#   docker build -f apps/api/Dockerfile --build-arg VERSION=<x.y.z> --build-arg COMMIT=<sha> .
# REQ-DEP-001: multi-stage, base images pinned by digest (tag in the comment above each FROM),
#              `--locked`, a static binary on `scratch`: no shell, no package manager, non-root.
# REQ-DEP-002: no ENV at all and no secret-like ARG; everything that differs between environments
#              comes from the environment at run time. The context is an allow-list (`.dockerignore`).
# Needs BuildKit (cache mounts); `docker buildx` is the default builder of current Docker.

# The Rust the repo builds with (CI: dtolnay/rust-toolchain `stable`). `pnpm supply:check` fails when
# it is older than the newest `rust-version` among the API's locked dependencies.
# rust:1.99.1-alpine3.24
FROM rust:1.99.1-alpine3.24@sha256:44819b27be4c97b0e4d7203bd2e02c4820f97700211b6a37fb4c246a2de59383 AS builder

# A C compiler for the bundled SQLite and aws-lc (rustls' crypto); musl links them statically.
RUN apk add --no-cache musl-dev gcc

# The runtime file system: one user and group (uid/gid 10001), and /data owned by it, so a named
# volume mounted there starts writable. Nothing else: TLS roots are compiled in (webpki-roots).
RUN mkdir -p /rootfs/etc /rootfs/data /rootfs/tmp \
 && echo 'tran:x:10001:10001:tran:/nonexistent:/sbin/nologin' > /rootfs/etc/passwd \
 && echo 'tran:x:10001:' > /rootfs/etc/group \
 && chown 10001:10001 /rootfs/data \
 && chmod 0700 /rootfs/data \
 && chmod 1777 /rootfs/tmp

WORKDIR /src
# Everything `cargo build -p api` reads: the workspace manifests and every member (cargo loads all
# of them), the API's migrations (embedded with include_str!) and the eligibility locales the push
# payloads embed. Downloaded crates are cached in a BuildKit cache mount.
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY locales/ locales/
COPY apps/api/ apps/api/

# Build-time facts, not configuration: the release version (must equal the workspace version) and
# the commit, which the binary reads with option_env!("TRAN_COMMIT") (REQ-OBS-009).
ARG VERSION=""
ARG COMMIT=""
# Only the registry is a cache mount: a cached target/ would trust file times, and a COPY keeps
# the source's times, so stale artefacts could survive a source change.
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    set -eu; \
    if [ -n "$VERSION" ]; then \
      built="$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -n1)"; \
      [ "$VERSION" = "$built" ] || { echo "VERSION=$VERSION but the workspace is $built" >&2; exit 1; }; \
    fi; \
    TRAN_COMMIT="$COMMIT" cargo build --release --locked -p api; \
    if readelf -d target/release/api | grep -q NEEDED; then echo "api is not static" >&2; exit 1; fi; \
    install -D -m 0555 target/release/api /rootfs/api

FROM scratch AS runtime
COPY --from=builder /rootfs/ /
# The default DATABASE_URL, data/api.sqlite3, resolves to the /data volume from here.
WORKDIR /
USER 10001:10001
EXPOSE 3001
ENTRYPOINT ["/api"]
