# syntax=docker/dockerfile:1
# REQ-DEP-001: The API is one small, reproducible, non-root image
# REQ-DEP-002: The image holds no configuration and no secret

# Stage 1: Build
# Tag: rust:1.85-alpine3.21
FROM rust:1.85-alpine3.21@sha256:4333721398de61f53ccbe53b0b855bcc4bb49e55828e8f652d7a8ac33dd0c118 AS builder

ARG VERSION=0.1.0
ARG COMMIT=HEAD

RUN apk add --no-cache musl-dev gcc make cmake perl

WORKDIR /workspace

# Copy manifests
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY apps/api/ apps/api/

# Build user for runtime
RUN addgroup -g 10001 -S tran && \
    adduser -u 10001 -S tran -G tran

# Build API binary with --locked
ENV TRAN_VERSION=${VERSION}
ENV TRAN_COMMIT=${COMMIT}
RUN cargo build --release --locked --package api

# Stage 2: Runtime
# Tag: alpine:3.21.3
FROM alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c AS runtime

# Non-root user accounts
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

# Binary and migrations
COPY --from=builder /workspace/target/release/api /usr/local/bin/api
COPY --from=builder /workspace/apps/api/migrations /usr/local/share/tran/migrations

# Remove shell and package manager (REQ-DEP-001)
RUN rm -rf /sbin/apk /bin/sh /bin/ash /bin/busybox

USER tran:tran

ENV APP_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

ENTRYPOINT ["/usr/local/bin/api"]
