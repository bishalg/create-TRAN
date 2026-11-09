#!/usr/bin/env bash
# Copies the conformance manifest the instrumentation wrote to its additionalTestOutputDir, and the
# Android Gradle plugin pulled from the device, to e2e/conformance/android.json (REQ-SCR-008,
# e2e/conformance/README.md). Run by `pnpm android:test` after the connected tests.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
pulled="$root/apps/android/app/build/outputs/connected_android_test_additional_output"
manifest="$(find "$pulled" -name android.json -type f 2>/dev/null | head -n 1 || true)"
if [[ -z "$manifest" ]]; then
  echo "conformance: no android.json under $pulled" >&2
  exit 1
fi
mkdir -p "$root/e2e/conformance"
cp "$manifest" "$root/e2e/conformance/android.json"
echo "conformance: e2e/conformance/android.json"
