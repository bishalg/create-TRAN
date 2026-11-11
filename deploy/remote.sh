#!/usr/bin/env bash
# deploy/remote.sh <environment> <registry/name@sha256:<digest>>
#
# Runs scripts/deploy.sh ON the target host over SSH (spec 032 REQ-DEP-008, docs/DEPLOY.md): ships
# the script, the Compose target and the migrations (for the contract warnings), logs the host in to
# the registry for the pull, deploys, logs out. The target's env file and the deploy state stay on
# the host. Strict host-key checking: the host's public key comes from configuration, never from a
# first connection.
#
# Required: DEPLOY_HOST, DEPLOY_SSH_KEY (private key), DEPLOY_KNOWN_HOSTS (known_hosts lines).
# Optional: DEPLOY_USER (default deploy), DEPLOY_PATH (folder on the host, default tran),
#           REGISTRY_USER and REGISTRY_TOKEN (a short-lived pull credential for the image's registry).
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

[[ $# -eq 2 ]] || die "usage: deploy/remote.sh <environment> <registry/name@sha256:<64 hex>>"
ENVIRONMENT="$1"
IMAGE="$2"
[[ "$ENVIRONMENT" =~ ^[a-z][a-z0-9-]{0,30}$ ]] || die "invalid environment '$ENVIRONMENT'"
[[ "$IMAGE" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}$ ]] ||
  die "the image must be a full reference by digest, got '$IMAGE'"
for name in DEPLOY_HOST DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS; do
  [[ -n "${!name:-}" ]] || die "$name is not set"
done
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PATH="${DEPLOY_PATH:-tran}"
[[ "$DEPLOY_PATH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "DEPLOY_PATH may hold letters, digits, . _ / - only"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
(
  umask 077
  printf '%s\n' "$DEPLOY_SSH_KEY" >"$WORK/key"
  printf '%s\n' "$DEPLOY_KNOWN_HOSTS" >"$WORK/known_hosts"
)
SSH=(ssh -i "$WORK/key" -o IdentitiesOnly=yes -o BatchMode=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$WORK/known_hosts"
  "$DEPLOY_USER@$DEPLOY_HOST")
REGISTRY="${IMAGE%%/*}"
remote_path="$(printf '%q' "$DEPLOY_PATH")"

echo "Shipping the deploy bundle to $DEPLOY_HOST:$DEPLOY_PATH"
tar -C "$ROOT_DIR" -czf - scripts/deploy.sh deploy/compose.yaml deploy/proxy apps/api/migrations |
  "${SSH[@]}" "mkdir -p $remote_path && tar -xzf - -C $remote_path"

logged_in=0
if [[ -n "${REGISTRY_TOKEN:-}" ]]; then
  [[ -n "${REGISTRY_USER:-}" ]] || die "REGISTRY_USER is required with REGISTRY_TOKEN"
  # The token travels on stdin, never on a command line.
  printf '%s' "$REGISTRY_TOKEN" |
    "${SSH[@]}" "docker login $(printf '%q' "$REGISTRY") --username $(printf '%q' "$REGISTRY_USER") --password-stdin" >/dev/null
  logged_in=1
fi

status=0
"${SSH[@]}" "cd $remote_path && bash scripts/deploy.sh $(printf '%q' "$ENVIRONMENT") $(printf '%q' "$IMAGE")" || status=$?
if ((logged_in)); then
  "${SSH[@]}" "docker logout $(printf '%q' "$REGISTRY")" >/dev/null || true
fi
exit "$status"
