#!/usr/bin/env bash
# `pnpm ios:screenshots` (REQ-PERF-007, ADR-0031): drives the real app on a simulator through every
# theme × locale and compares each screen with this machine's references in apps/ios/.screenshots/
# (gitignored, one folder per simulator model and iOS version). A missing reference is recorded, so
# the first run is the baseline. `--record` re-records all of them after an intended UI change.
#
# Simulator: $IOS_SCREENSHOT_DEVICE (a name, e.g. "iPhone 17"), else the first available iPhone.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IOS="$ROOT/apps/ios"

record=0
[[ "${1:-}" == "--record" ]] && record=1

name="${IOS_SCREENSHOT_DEVICE:-}"
line="$(xcrun simctl list devices available | grep -E "^ +${name:-iPhone}[^(]* \([0-9A-F-]{36}\)" | head -1)"
udid="$(sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/' <<<"$line")"
if [[ -z "$udid" ]]; then
  echo "ios:screenshots: no available simulator matches '${name:-iPhone}'" >&2
  exit 1
fi
echo "ios:screenshots: $(sed -E 's/^ +//; s/ \(([0-9A-F-]{36})\).*//' <<<"$line") ($udid)"

xcrun simctl bootstatus "$udid" -b >/dev/null
# The same status bar on every run: the clock, signal and battery are part of every screenshot.
xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100

# Failure images from an earlier run must not be mistaken for this run's.
rm -rf "$IOS/build/screenshots"
TEST_RUNNER_TRAN_SCREENSHOTS_RECORD="$record" TEST_RUNNER_TRAN_SCREENSHOTS_ONLY="${TRAN_SCREENSHOTS_ONLY:-}" xcodebuild test \
  -project "$IOS/TranVotingDemo.xcodeproj" \
  -scheme TranVotingDemoScreenshots \
  -destination "id=$udid" \
  CODE_SIGNING_ALLOWED=NO \
  -quiet
echo "ios:screenshots: passed ($(find "$IOS/.screenshots" -name '*.png' | wc -l | tr -d ' ') references)"
