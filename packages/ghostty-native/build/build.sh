#!/usr/bin/env bash
# Build ghostty-native N-API bindings for termless.
#
# Ghostty's terminal emulation core is compiled directly as a Zig dependency
# (not a separate shared library). The build:
#   1. Clones ghostty source (if not already present)
#   2. Builds napigen N-API bindings with ghostty as a Zig module
#   3. Copies the .node file to the package root
#
# Requirements:
#   - Nix with flakes enabled (uses ghostty's nix flake for correct SDK setup)
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
GHOSTTY_DIR="$NATIVE_DIR/.ghostty-src"
GHOSTTY_VERSION="v1.3.1"

echo "Building @termless/ghostty-native..."

# ─── Phase 1: Ensure ghostty source is available ─────────

echo
echo "Phase 1: Ensuring ghostty source ($GHOSTTY_VERSION)..."

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

# ─── Phase 2: Build N-API bindings ───────────────────────

echo
echo "Phase 2: Building N-API bindings (ghostty compiled as Zig dependency)..."
echo "  Using ghostty's nix flake for correct Zig version and SDK setup."
echo "  This may take a few minutes on first build."

cd "$NATIVE_DIR"

# Use ghostty's nix flake to get the correct Zig version and macOS SDK setup.
# Ghostty requires specific Zig and SDK versions that its flake provides.
# We unset SDKROOT/DEVELOPER_DIR so zig finds the system SDK via xcrun
# (ghostty's build.zig eagerly evaluates XCFramework targets on macOS).
nix develop "$GHOSTTY_DIR" --command bash -c "unset SDKROOT DEVELOPER_DIR; zig build --release=fast" || {
  echo
  echo "ERROR: Failed to build N-API bindings."
  echo
  echo "  The build uses ghostty's nix flake for Zig and SDK setup."
  echo "  Make sure you have nix with flakes enabled."
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
