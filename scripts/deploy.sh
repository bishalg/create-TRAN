#!/usr/bin/env bash
# REQ-DEP-005: A deploy runs its steps in one order
# REQ-DEP-006: A rollback is the same deploy with the previous digest
# Rationale: ADR-0051 (Build once, migrate then roll)
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: scripts/deploy.sh <environment> <image digest>" >&2
  exit 1
fi

ENVIRONMENT="$1"
IMAGE_DIGEST="$2"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${DEPLOY_STATE_DIR:-$ROOT_DIR/deploy/state}"
mkdir -p "$STATE_DIR"
CURRENT_DIGEST_FILE="$STATE_DIR/${ENVIRONMENT}.digest"

echo "=== Deploying to ${ENVIRONMENT}: ${IMAGE_DIGEST} ==="

# Check for contract migrations (REQ-DEP-006)
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$ROOT_DIR/apps/api/migrations}"
if [[ -d "$MIGRATIONS_DIR" ]]; then
  for mig in "$MIGRATIONS_DIR"/*.sql; do
    if [[ -f "$mig" ]] && grep -q -- "-- contract:" "$mig"; then
      contract_boundary=$(grep -- "-- contract:" "$mig" | head -n1 | sed -e 's/.*-- contract:[[:space:]]*//')
      echo "warning: migration $(basename "$mig") has contract boundary: ${contract_boundary}"
      echo "warning: rollback past ${contract_boundary} is not supported once applied"
    fi
  done
fi

TARGET="${DEPLOY_TARGET:-compose}"

# Step 1: Validate configuration (REQ-DEP-003)
echo "[1/5] Validating configuration for ${ENVIRONMENT}..."
if [[ "$TARGET" == "compose" ]]; then
  docker run --rm \
    --read-only \
    --user 10001:10001 \
    --env APP_ENV="${ENVIRONMENT}" \
    --env-file "${DEPLOY_ENV_FILE:-.env}" \
    "$IMAGE_DIGEST" check-config
elif [[ -n "${DEPLOY_TARGET_CMD:-}" ]]; then
  "$DEPLOY_TARGET_CMD" validate-config "$ENVIRONMENT" "$IMAGE_DIGEST"
fi

# Step 2: Run database migrations once with the new image (REQ-DB-003)
echo "[2/5] Running migrations..."
if [[ "$TARGET" == "compose" ]]; then
  docker compose -f "$ROOT_DIR/deploy/compose.yaml" run --rm \
    -e APP_ENV="${ENVIRONMENT}" \
    -e MIGRATE_ON_START=false \
    api migrate
elif [[ -n "${DEPLOY_TARGET_CMD:-}" ]]; then
  "$DEPLOY_TARGET_CMD" migrate "$ENVIRONMENT" "$IMAGE_DIGEST"
fi

# Step 3: Start the new version (REQ-DEP-005)
echo "[3/5] Starting new version..."
if [[ "$TARGET" == "compose" ]]; then
  API_IMAGE="$IMAGE_DIGEST" docker compose -f "$ROOT_DIR/deploy/compose.yaml" up -d --no-recreate api
elif [[ -n "${DEPLOY_TARGET_CMD:-}" ]]; then
  "$DEPLOY_TARGET_CMD" start-new "$ENVIRONMENT" "$IMAGE_DIGEST"
fi

# Step 4: Wait for readiness probe (REQ-OBS-007)
echo "[4/5] Waiting for /api/health/ready..."
READY_URL="${READY_URL:-http://localhost:3001/api/health/ready}"
DEADLINE="${DEPLOY_DEADLINE_SECONDS:-30}"

if [[ "$TARGET" == "compose" ]]; then
  ready=0
  for ((i=1; i<=DEADLINE; i++)); do
    if curl -s -f "$READY_URL" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "$ready" -ne 1 ]]; then
    echo "error: readiness check timed out after ${DEADLINE}s on ${READY_URL}" >&2
    exit 1
  fi
elif [[ -n "${DEPLOY_TARGET_CMD:-}" ]]; then
  "$DEPLOY_TARGET_CMD" wait-ready "$ENVIRONMENT" "$IMAGE_DIGEST"
fi

# Step 5: Drain previous version with SIGTERM (REQ-OBS-008)
echo "[5/5] Draining previous version..."
if [[ "$TARGET" == "compose" ]]; then
  # Graceful stop with timeout
  docker compose -f "$ROOT_DIR/deploy/compose.yaml" stop -t "${SHUTDOWN_GRACE_SECONDS:-10}" api || true
elif [[ -n "${DEPLOY_TARGET_CMD:-}" ]]; then
  "$DEPLOY_TARGET_CMD" drain-old "$ENVIRONMENT" "$IMAGE_DIGEST"
fi

# Record current digest for rollback (REQ-DEP-006)
echo "$IMAGE_DIGEST" > "$CURRENT_DIGEST_FILE"
echo "=== Deploy complete: ${IMAGE_DIGEST} is live on ${ENVIRONMENT} ==="
