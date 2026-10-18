#!/usr/bin/env bash
# Regenerate Swift + Kotlin bindings from the tran-uniffi cdylib.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

cargo build -p tran-uniffi --release --lib
LIB="$CARGO_TARGET_DIR/release/libtran_uniffi.dylib"
if [[ ! -f "$LIB" ]]; then
  LIB="$CARGO_TARGET_DIR/release/libtran_uniffi.so"
fi

cargo run -p tran-uniffi --features bindgen --bin uniffi-bindgen -- \
  generate --library "$LIB" --language swift \
  --out-dir apps/ios/Sources/TranVotingDemo/Generated/UniFFI

cargo run -p tran-uniffi --features bindgen --bin uniffi-bindgen -- \
  generate --library "$LIB" --language kotlin \
  --out-dir apps/android/app/src/main/kotlin/com/tran/voting/uniffi

echo "uniffi-generate: Swift + Kotlin bindings updated."
