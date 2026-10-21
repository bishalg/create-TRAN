#!/usr/bin/env bash
# `pnpm smoke` (REQ-PERF-008): build the release web, Android and iOS apps, then check each starts.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
pnpm run build:libs
bash scripts/build-release.sh
# The web build is made and served by the Playwright config (production `vite build` + preview).
pnpm --filter e2e exec playwright test -c playwright.metrics.config.ts --project smoke
