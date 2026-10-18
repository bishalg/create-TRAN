#!/usr/bin/env bash
# Xcode pre-build: compile tran-uniffi for the active SDK/arch and stage libtran_uniffi.a.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export CARGO_TARGET_DIR="$ROOT/target"
cd "$ROOT"

PLATFORM="${PLATFORM_NAME:-iphonesimulator}"
ARCH="${ARCHS:-arm64}"
case "$PLATFORM" in
  iphonesimulator)
    if [[ "$ARCH" == *x86_64* ]]; then
      RUST_TARGET=x86_64-apple-ios
    else
      RUST_TARGET=aarch64-apple-ios-sim
    fi
    ;;
  iphoneos)
    RUST_TARGET=aarch64-apple-ios
    ;;
  macosx)
    RUST_TARGET="$(rustc -vV | sed -n 's/^host: //p')"
    ;;
  *)
    RUST_TARGET="$(rustc -vV | sed -n 's/^host: //p')"
    ;;
esac

rustup target add "$RUST_TARGET" 2>/dev/null || true
cargo build -p tran-uniffi --release --target "$RUST_TARGET" --lib

STAGE="$ROOT/apps/ios/RustLib/$RUST_TARGET"
mkdir -p "$STAGE"
cp "$CARGO_TARGET_DIR/$RUST_TARGET/release/libtran_uniffi.a" "$STAGE/"

cat > "$ROOT/apps/ios/RustLib/active.xcconfig" <<EOF
RUST_UNIFFI_LIB_DIR = \$(SRCROOT)/RustLib/$RUST_TARGET
EOF

echo "build-tran-uniffi: staged $STAGE/libtran_uniffi.a"
