#!/usr/bin/env bash
# `pnpm android:screenshots` (REQ-PERF-003, ADR-0031): Robolectric renders every screen × theme × locale
# on the JVM and Roborazzi compares it with this machine's references in app/.screenshots/ (gitignored).
# No references yet → this run records them and becomes the baseline. `--record` re-records on purpose
# after an intended UI change.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ANDROID="$ROOT/apps/android"
REFERENCES="$ANDROID/app/.screenshots"

# JVM tests load the host build of the Rust core through JNA (UNIFFI_LIB_DIR in app/build.gradle.kts).
(cd "$ROOT" && cargo build -p tran-uniffi --release --lib --quiet)

task=verifyRoborazziDebug
if [[ "${1:-}" == "--record" ]] || [[ -z "$(ls -A "$REFERENCES" 2>/dev/null)" ]]; then
  task=recordRoborazziDebug
  echo "android:screenshots: recording references into apps/android/app/.screenshots/ (this machine's baseline)"
fi

cd "$ANDROID"
# Diff images from an earlier failure must not be mistaken for this run's.
rm -rf app/build/outputs/roborazzi
./gradlew ":app:$task" --tests '*ScreenshotTest*' --rerun-tasks -q
echo "android:screenshots: $task passed ($(ls "$REFERENCES" | wc -l | tr -d ' ') references)"
