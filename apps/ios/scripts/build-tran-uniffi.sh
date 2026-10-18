#!/usr/bin/env bash
# Xcode pre-build: compile tran-uniffi for the active SDK/arch(s) and stage libtran_uniffi.a.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export CARGO_TARGET_DIR="$ROOT/target"
cd "$ROOT"

PLATFORM="${PLATFORM_NAME:-iphonesimulator}"

rust_target_for() {
  local platform="$1"
  local arch="$2"
  case "$platform" in
    iphonesimulator)
      if [[ "$arch" == *x86_64* ]]; then
        echo x86_64-apple-ios
      else
        echo aarch64-apple-ios-sim
      fi
      ;;
    iphoneos)
      echo aarch64-apple-ios
      ;;
    macosx)
      rustc -vV | sed -n 's/^host: //p'
      ;;
    *)
      rustc -vV | sed -n 's/^host: //p'
      ;;
  esac
}

build_for_rust_target() {
  local rust_target="$1"
  rustup target add "$rust_target" 2>/dev/null || true
  cargo build -p tran-uniffi --release --target "$rust_target" --lib
  local stage="$ROOT/apps/ios/RustLib/$rust_target"
  mkdir -p "$stage"
  cp "$CARGO_TARGET_DIR/$rust_target/release/libtran_uniffi.a" "$stage/"
  echo "build-tran-uniffi: staged $stage/libtran_uniffi.a"
}

if [[ -n "${ARCHS:-}" ]]; then
  # Fat / multi-arch simulator builds invoke the script once with every active arch.
  read -r -a build_archs <<< "${ARCHS}"
elif [[ -n "${CURRENT_ARCH:-}" && "${CURRENT_ARCH}" != "undefined_arch" ]]; then
  build_archs=("${CURRENT_ARCH}")
else
  build_archs=(arm64)
fi

seen_targets=()
for arch in "${build_archs[@]}"; do
  rust_target="$(rust_target_for "$PLATFORM" "$arch")"
  already=false
  for t in "${seen_targets[@]:-}"; do
    if [[ "$t" == "$rust_target" ]]; then
      already=true
      break
    fi
  done
  if [[ "$already" == true ]]; then
    continue
  fi
  seen_targets+=("$rust_target")
  build_for_rust_target "$rust_target"
done
