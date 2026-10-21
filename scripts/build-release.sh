#!/usr/bin/env bash
# Release builds of the native apps, where `pnpm smoke` and `pnpm metrics --native` look for them
# (ADR-0031): apps/android/app/build/outputs/apk/release/ and .metrics/ios/ (both gitignored).
# A platform whose toolchain is missing is skipped with a message; the checks then report it.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -n "${ANDROID_HOME:-}" || -d "$HOME/Library/Android/sdk" ]]; then
  (cd "$ROOT/apps/android" && ./gradlew :app:assembleRelease -q)
else
  echo "build-release: no Android SDK; skipping the APK"
fi

if [[ "$(uname)" == "Darwin" ]] && command -v xcodebuild >/dev/null; then
  xcodebuild -project "$ROOT/apps/ios/TranVotingDemo.xcodeproj" -scheme TranVotingDemo \
    -configuration Release -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$ROOT/.metrics/ios" -quiet build CODE_SIGNING_ALLOWED=NO
else
  echo "build-release: no Xcode; skipping the iOS app"
fi
