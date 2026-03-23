#!/usr/bin/env bash
# Build libghostty-vt + napigen N-API bindings for termless.
#
# Two-phase build:
#   1. Clone ghostty and build libghostty-vt shared library
#   2. Build Zig napigen bindings that link against libghostty-vt
#
# Requirements:
#   - Zig 0.15.2+ (via nix or system)
#   - macOS: Xcode Command Line Tools (for macOS SDK)
#   - Internet access (first build clones ghostty + fetches napigen)
#
# Usage:
#   cd packages/ghostty-native && bash build/build.sh
#
# Output:
#   termless-ghostty-native.node (in package root)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NATIVE_DIR="$PKG_DIR/native"
FLAKE_DIR="$(cd "$PKG_DIR/../.." && pwd)"
GHOSTTY_DIR="$NATIVE_DIR/.ghostty-src"
GHOSTTY_VERSION="v1.3.1"
GHOSTTY_COMMIT="22efb0be2bbea73e5339f5426fa3b20edabcaa11"

echo "Building @termless/ghostty-native..."

# ─── Ensure Zig is available ─────────────────────────────

ZIG=""

find_zig() {
  # Prefer zig already in PATH (may be from nix develop)
  if command -v zig &>/dev/null; then
    local ver
    ver=$(zig version)
    local required="0.15.2"
    if [[ "$(printf '%s\n' "$required" "$ver" | sort -V | head -n1)" == "$required" ]]; then
      ZIG="direct"
      echo "  Using zig $ver from PATH"
      return 0
    fi
    echo "  Zig $ver in PATH is too old (need $required+)"
  fi

  # Try nix-shell (NOT --pure: ghostty on macOS needs system Xcode SDK)
  if command -v nix-shell &>/dev/null; then
    echo "  Using zig from nix-shell"
    ZIG="nix"
    return 0
  fi

  echo "ERROR: zig 0.15.2+ required."
  echo "  Install via nix:  nix-shell -p zig"
  echo "  Or install zig:   https://ziglang.org/download/"
  exit 1
}

find_zig

# Run a command with zig available.
# On macOS, ghostty requires system Xcode SDK (not nix-provided).
# We unset SDKROOT/DEVELOPER_DIR so zig finds the system SDK via xcrun.
run_zig() {
  if [[ "$ZIG" == "direct" ]]; then
    env -u SDKROOT -u DEVELOPER_DIR "$@"
  else
    # nix-shell (not --pure) with SDKROOT/DEVELOPER_DIR unset
    nix-shell -p zig --run "unset SDKROOT DEVELOPER_DIR; $(printf '%q ' "$@")"
  fi
}

# ─── Phase 1: Build libghostty-vt ────────────────────────

# Allow skipping Phase 1 if the user pre-built libghostty-vt
if [[ -n "${GHOSTTY_LIB_DIR:-}" && -n "${GHOSTTY_INCLUDE_DIR:-}" ]]; then
  echo
  echo "Phase 1: SKIPPED (using pre-built libghostty-vt)"
  echo "  GHOSTTY_LIB_DIR=$GHOSTTY_LIB_DIR"
  echo "  GHOSTTY_INCLUDE_DIR=$GHOSTTY_INCLUDE_DIR"
else

echo
echo "Phase 1: Building libghostty-vt from ghostty $GHOSTTY_VERSION..."

if [[ ! -d "$GHOSTTY_DIR" ]]; then
  echo "  Cloning ghostty (shallow, pinned to $GHOSTTY_VERSION)..."
  git clone --depth 1 --branch "$GHOSTTY_VERSION" \
    https://github.com/ghostty-org/ghostty.git "$GHOSTTY_DIR"
else
  echo "  Using cached ghostty source in $GHOSTTY_DIR"
  # Verify we have the right version
  CURRENT=$(cd "$GHOSTTY_DIR" && git describe --tags --exact-match 2>/dev/null || echo "unknown")
  if [[ "$CURRENT" != "$GHOSTTY_VERSION" ]]; then
    echo "  Version mismatch ($CURRENT != $GHOSTTY_VERSION), re-cloning..."
    rm -rf "$GHOSTTY_DIR"
    git clone --depth 1 --branch "$GHOSTTY_VERSION" \
      https://github.com/ghostty-org/ghostty.git "$GHOSTTY_DIR"
  fi
fi

echo "  Fetching dependencies..."
cd "$GHOSTTY_DIR"
run_zig zig build --fetch 2>/dev/null || true

echo "  Building libghostty-vt (zig build lib-vt)..."
echo "  This may take a few minutes on first build."

# Build libghostty-vt. On macOS, ghostty needs the system Xcode SDK.
# Its build.zig eagerly evaluates XCFramework targets on Darwin, which
# requires iOS + macOS SDKs. Running outside nix or via ghostty's own
# dev shell works best.
run_zig zig build lib-vt || {
  echo
  echo "ERROR: Failed to build libghostty-vt."
  echo
  echo "Common issues on macOS:"
  echo "  - ghostty's build.zig eagerly evaluates XCFramework targets"
  echo "    which require the full macOS + iOS SDK (Xcode, not just CLT)"
  echo "  - Install Xcode: xcode-select --install"
  echo "  - Try using ghostty's own dev environment:"
  echo "      cd .ghostty-src && nix develop .#ghostty"
  echo "      zig build lib-vt"
  echo
  echo "If you have a pre-built libghostty-vt, set these env vars and"
  echo "re-run this script to skip Phase 1:"
  echo "  export GHOSTTY_LIB_DIR=/path/to/lib"
  echo "  export GHOSTTY_INCLUDE_DIR=/path/to/include"
  exit 1
}

# Find the built library
GHOSTTY_LIB_DIR="$GHOSTTY_DIR/zig-out/lib"
GHOSTTY_INCLUDE_DIR="$GHOSTTY_DIR/zig-out/include"

# Headers may be at zig-out/include or the repo's include/ directory
if [[ ! -d "$GHOSTTY_INCLUDE_DIR/ghostty" ]]; then
  GHOSTTY_INCLUDE_DIR="$GHOSTTY_DIR/include"
fi

GHOSTTY_LIB=$(find "$GHOSTTY_LIB_DIR" -maxdepth 1 -name "libghostty-vt*" \( -name "*.dylib" -o -name "*.so" -o -name "*.a" \) 2>/dev/null | head -1)
if [[ -z "$GHOSTTY_LIB" ]]; then
  echo "  ERROR: libghostty-vt not found in $GHOSTTY_LIB_DIR"
  ls -la "$GHOSTTY_LIB_DIR" 2>/dev/null || echo "  (directory does not exist)"
  exit 1
fi

echo "  Built: $(basename "$GHOSTTY_LIB") ($(du -h "$GHOSTTY_LIB" | cut -f1))"
echo "  Headers: $GHOSTTY_INCLUDE_DIR"

fi  # end of Phase 1 skip check

# ─── Phase 2: Build napigen N-API bindings ───────────────

echo
echo "Phase 2: Building N-API bindings..."

export GHOSTTY_LIB_DIR
export GHOSTTY_INCLUDE_DIR

cd "$NATIVE_DIR"
run_zig zig build --release=fast || {
  echo
  echo "ERROR: Failed to build N-API bindings."
  echo "  Check the error output above."
  exit 1
}

# ─── Phase 3: Copy output ────────────────────────────────

echo
echo "Phase 3: Copying output..."

NODE_FILE=""

# Check zig-out for the .node file
if [[ -f "$NATIVE_DIR/zig-out/lib/termless-ghostty-native.node" ]]; then
  NODE_FILE="$NATIVE_DIR/zig-out/lib/termless-ghostty-native.node"
fi

# Try .dylib/.so
if [[ -z "$NODE_FILE" ]]; then
  NODE_FILE=$(find "$NATIVE_DIR/zig-out/lib" -maxdepth 1 -name "libtermless_ghostty_native*" \( -name "*.dylib" -o -name "*.so" \) 2>/dev/null | head -1)
fi

if [[ -z "$NODE_FILE" ]]; then
  echo "ERROR: No output binary found."
  ls -la "$NATIVE_DIR/zig-out/lib/" 2>/dev/null || echo "(zig-out/lib/ does not exist)"
  exit 1
fi

cp "$NODE_FILE" "$PKG_DIR/termless-ghostty-native.node"
SIZE=$(du -h "$PKG_DIR/termless-ghostty-native.node" | cut -f1)
echo "  termless-ghostty-native.node ($SIZE)"
echo
echo "Build complete."
