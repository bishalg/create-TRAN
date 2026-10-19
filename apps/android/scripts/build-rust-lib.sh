#!/usr/bin/env bash
# Gradle pre-build: compile tran-uniffi for the device ABIs and stage libtran_uniffi.so
# under app/src/main/jniLibs/<abi>/ (mirrors apps/ios/scripts/build-tran-uniffi.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export CARGO_TARGET_DIR="$ROOT/target"
cd "$ROOT"

find_ndk() {
  local candidate
  for candidate in "${ANDROID_NDK_HOME:-}" "${ANDROID_NDK_LATEST_HOME:-}"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  ls -d "$sdk"/ndk/* 2>/dev/null | sort -V | tail -1
}

NDK="$(find_ndk)"
if [[ -z "$NDK" || ! -d "$NDK" ]]; then
  echo "build-rust-lib: Android NDK not found; set ANDROID_NDK_HOME or install one via the SDK manager" >&2
  exit 1
fi

TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/$(ls "$NDK/toolchains/llvm/prebuilt" | head -1)"

# Rust target → Android ABI → NDK clang prefix. API 26 matches minSdk.
build_abi() {
  local rust_target="$1" abi="$2" clang_prefix="$3"
  local upper linker_var
  upper="$(echo "$rust_target" | tr 'a-z-' 'A-Z_')"
  linker_var="CARGO_TARGET_${upper}_LINKER"
  rustup target add "$rust_target" 2>/dev/null || true
  export "$linker_var=$TOOLCHAIN/bin/${clang_prefix}-clang"
  cargo build -p tran-uniffi --release --target "$rust_target" --lib
  local stage="$ROOT/apps/android/app/src/main/jniLibs/$abi"
  mkdir -p "$stage"
  cp "$CARGO_TARGET_DIR/$rust_target/release/libtran_uniffi.so" "$stage/"
  echo "build-rust-lib: staged $stage/libtran_uniffi.so"
}

build_abi aarch64-linux-android arm64-v8a aarch64-linux-android26
build_abi x86_64-linux-android x86_64 x86_64-linux-android26
