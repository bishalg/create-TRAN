#!/usr/bin/env bash
# scripts/deploy.sh <environment> <registry/name@sha256:<digest>>   deploy that image
# scripts/deploy.sh <environment> --rollback                         deploy the previous image again
#
# REQ-DEP-005: check config -> migrate -> start new -> wait for ready -> switch and drain old.
# REQ-DEP-006: a rollback is the same deploy with the previous image; both are recorded on the host.
# Rationale: ADR-0051. Playbook: docs/DEPLOY.md. Runs ON the target host (the workflow ships it there).
#
# Target: Docker Compose (deploy/compose.yaml), two slots behind a proxy. The new image starts in
# the inactive slot; the proxy switches only after that slot is ready, and the old slot is stopped
# only after the switch. Any failure before the switch leaves the old slot serving, untouched.
#
# Environment (all optional):
#   DEPLOY_TARGET          compose (the only target this script knows; a fork adds its own)
#   DEPLOY_STATE_DIR       where state survives on the host (default: deploy/state, gitignored)
#   DEPLOY_ENV_FILE        the target's configuration (default: <state>/<environment>/app.env)
#   DEPLOY_READY_TIMEOUT   seconds to wait for /api/health/ready (default 60)
#   DEPLOY_READY_INTERVAL  seconds between probes (default 2)
#   DEPLOY_GRACE_SECONDS   SIGTERM grace for the old slot (default 30)
#   API_BLUE_PORT, API_GREEN_PORT, PUBLIC_PORT   loopback probe ports and the public port
#   MIGRATIONS_DIR         migrations to read `-- contract:` warnings from (default apps/api/migrations)
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

if [[ $# -ne 2 ]]; then
  echo "usage: scripts/deploy.sh <environment> <registry/name@sha256:<64 hex>> | --rollback" >&2
  exit 2
fi

ENVIRONMENT="$1"
REQUESTED="$2"
[[ "$ENVIRONMENT" =~ ^[a-z][a-z0-9-]{0,30}$ ]] ||
  die "environment must be lower-case letters, digits and dashes, got '$ENVIRONMENT'"

TARGET="${DEPLOY_TARGET:-compose}"
[[ "$TARGET" == compose ]] || die "unknown DEPLOY_TARGET '$TARGET' (this script knows: compose)"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/deploy/compose.yaml"
STATE_DIR="${DEPLOY_STATE_DIR:-$ROOT_DIR/deploy/state}/$ENVIRONMENT"
ENV_FILE="${DEPLOY_ENV_FILE:-$STATE_DIR/app.env}"
READY_TIMEOUT="${DEPLOY_READY_TIMEOUT:-60}"
READY_INTERVAL="${DEPLOY_READY_INTERVAL:-2}"
GRACE="${DEPLOY_GRACE_SECONDS:-30}"
for number in "$READY_TIMEOUT" "$READY_INTERVAL" "$GRACE"; do
  [[ "$number" =~ ^[0-9]+$ ]] || die "timeouts are whole seconds, got '$number'"
done
((READY_INTERVAL > 0)) || die "DEPLOY_READY_INTERVAL must be at least 1"

mkdir -p "$STATE_DIR/proxy"
state() { if [[ -f "$STATE_DIR/$1" ]]; then cat "$STATE_DIR/$1"; fi; }
CURRENT="$(state current)"
PREVIOUS="$(state previous)"
ACTIVE="$(state active-slot)"

if [[ "$REQUESTED" == --rollback ]]; then
  [[ -n "$PREVIOUS" ]] || die "no previous image is recorded for $ENVIRONMENT in $STATE_DIR"
  IMAGE="$PREVIOUS"
  echo "Rolling back $ENVIRONMENT to the previous image."
else
  IMAGE="$REQUESTED"
fi
[[ "$IMAGE" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}$ ]] ||
  die "the image must be a full reference by digest (registry/name@sha256:<64 hex>), got '$IMAGE'"
[[ -f "$ENV_FILE" ]] || die "the target's env file $ENV_FILE does not exist (set DEPLOY_ENV_FILE)"

case "$ACTIVE" in
  blue) NEW=green OLD=blue ;;
  green) NEW=blue OLD=green ;;
  '') NEW=blue OLD='' ;;
  *) die "unknown active slot '$ACTIVE' in $STATE_DIR/active-slot" ;;
esac

# The image reference is fixed here, once; every compose call below reads it from these variables.
SLOT_IMAGE_NEW="$IMAGE"
SLOT_IMAGE_OLD="${CURRENT:-$IMAGE}"
if [[ "$NEW" == blue ]]; then
  export API_BLUE_IMAGE="$SLOT_IMAGE_NEW" API_GREEN_IMAGE="$SLOT_IMAGE_OLD"
  NEW_PORT="${API_BLUE_PORT:-3101}"
else
  export API_GREEN_IMAGE="$SLOT_IMAGE_NEW" API_BLUE_IMAGE="$SLOT_IMAGE_OLD"
  NEW_PORT="${API_GREEN_PORT:-3102}"
fi
export DEPLOY_ENV_FILE="$ENV_FILE" DEPLOY_PROXY_DIR="$STATE_DIR/proxy" DEPLOY_GRACE_SECONDS="$GRACE"

compose() { docker compose --project-name "tran-$ENVIRONMENT" --file "$COMPOSE_FILE" "$@"; }

# Before the switch the new slot is disposable: stop and remove it, the old one keeps serving.
abandon() {
  compose rm --force --stop "api-$NEW" >/dev/null 2>&1 || true
  local message="$1; api-$NEW was removed"
  [[ -z "$OLD" ]] || message+="; api-$OLD ($CURRENT) is still serving"
  die "$message"
}

echo "=== Deploying $IMAGE to $ENVIRONMENT (slot $NEW) ==="

# One-way doors (REQ-DEP-006): a contract migration ends rollback past the release it names.
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$ROOT_DIR/apps/api/migrations}"
if [[ -d "$MIGRATIONS_DIR" ]]; then
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    [[ -f "$migration" ]] || continue
    boundary="$(sed -n 's/.*-- contract:[[:space:]]*//p' "$migration" | head -n1)"
    if [[ -n "$boundary" ]]; then
      echo "warning: migration $(basename "$migration") has contract boundary: $boundary"
      echo "warning: rollback past $boundary is not supported once applied"
    fi
  done
fi

echo "[1/6] Pulling the image"
compose pull --quiet "api-$NEW" || die "could not pull $IMAGE; nothing was changed"

echo "[2/6] Checking the configuration with the new image (REQ-DEP-003)"
compose run --rm --no-deps -T "api-$NEW" check-config ||
  die "the configuration in $ENV_FILE is not valid for this image; nothing was changed"

echo "[3/6] Migrating once with the new image (REQ-DB-003)"
compose run --rm --no-deps -T "api-$NEW" migrate ||
  die "the migration failed; ${CURRENT:-nothing} is still serving"

echo "[4/6] Starting api-$NEW and waiting for it to be ready (REQ-OBS-007)"
compose up --detach --no-deps --force-recreate "api-$NEW" || abandon "api-$NEW did not start"
READY_URL="http://127.0.0.1:$NEW_PORT/api/health/ready"
attempts=$((READY_TIMEOUT / READY_INTERVAL))
((attempts > 0)) || attempts=1
ready=0
for ((attempt = 1; attempt <= attempts; attempt++)); do
  if curl --silent --fail --max-time 2 --output /dev/null "$READY_URL"; then
    ready=1
    break
  fi
  sleep "$READY_INTERVAL"
done
if ((ready == 0)); then
  compose logs --no-color --tail 50 "api-$NEW" >&2 || true
  abandon "api-$NEW was not ready on $READY_URL within ${READY_TIMEOUT}s"
fi

echo "[5/6] Switching the proxy to api-$NEW, then draining ${OLD:+api-}${OLD:-nothing} (REQ-OBS-008)"
ACTIVE_CONF="$STATE_DIR/proxy/active.conf"
OLD_CONF=""
[[ -f "$ACTIVE_CONF" ]] && OLD_CONF="$(cat "$ACTIVE_CONF")"
# shellcheck disable=SC2016 # an nginx variable, written literally
printf 'set $tran_api_upstream http://api-%s:3001;\n' "$NEW" >"$ACTIVE_CONF.tmp"
mv "$ACTIVE_CONF.tmp" "$ACTIVE_CONF"
if ! { compose up --detach --no-deps proxy &&
  compose exec -T proxy nginx -t -q &&
  compose exec -T proxy nginx -s reload; }; then
  if [[ -n "$OLD_CONF" ]]; then
    printf '%s\n' "$OLD_CONF" >"$ACTIVE_CONF"
    compose exec -T proxy nginx -s reload || true
  fi
  abandon "the proxy did not switch to api-$NEW"
fi
if [[ -n "$OLD" ]]; then
  # SIGTERM, then up to the grace period for in-flight requests (the API drains on SIGTERM).
  compose stop --timeout "$GRACE" "api-$OLD" || echo "warning: api-$OLD did not stop cleanly" >&2
  compose rm --force "api-$OLD" >/dev/null || true
fi

echo "[6/6] Recording the deploy in $STATE_DIR"
if [[ -n "$CURRENT" && "$CURRENT" != "$IMAGE" ]]; then
  printf '%s\n' "$CURRENT" >"$STATE_DIR/previous"
fi
printf '%s\n' "$IMAGE" >"$STATE_DIR/current"
printf '%s\n' "$NEW" >"$STATE_DIR/active-slot"
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$NEW" "$IMAGE" >>"$STATE_DIR/history"
echo "=== Deploy complete: $IMAGE is serving $ENVIRONMENT from api-$NEW ==="
