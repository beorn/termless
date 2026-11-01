#!/bin/bash
# Verify kitty installation for the @termless/kitty backend.
#
# The runtime uses kitty's installed binary (`kitty +runpy`) as a Python
# subprocess bridge. A build-time C program measures pinned Kitty headers;
# only its deterministic JSON layout and receipt are shipped.
#
# IMPORTANT: kitty is licensed under GPL-3.0. This backend runs kitty's own
# code in a subprocess; the metadata executable is build-only and not shipped.
#
# Run: cd packages/kitty && bash build/build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(cd "$PKG_DIR/../.." && pwd)"

echo "=== @termless/kitty build ==="
echo "NOTE: This backend uses kitty's installed binary (GPL-3.0)."
echo "Verifying header-derived native layout; kitty must be installed separately."
echo ""

# Rebuild from the declared source/compiler/Python inputs. A missing derivation
# is an unverified build, never permission to accept a stale committed layout.
if ! command -v nix >/dev/null 2>&1; then
  echo "ERROR: Kitty native layout NOT VERIFIED: nix is required for the declared .#kitty-native-mode-layout derivation." >&2
  exit 1
fi
if ! LAYOUT_DIR=$(nix build --no-write-lock-file --no-link --print-out-paths "$REPO_DIR#kitty-native-mode-layout"); then
  echo "ERROR: Kitty native layout NOT VERIFIED: failed to build .#kitty-native-mode-layout from $REPO_DIR/flake.nix." >&2
  exit 1
fi
for artifact in native-mode-layout.json native-mode-layout.receipt.json; do
  if [ ! -f "$SCRIPT_DIR/$artifact" ] || [ ! -f "$LAYOUT_DIR/$artifact" ]; then
    echo "ERROR: Kitty native layout NOT VERIFIED: missing $artifact in $SCRIPT_DIR or derivation $LAYOUT_DIR." >&2
    exit 1
  fi
  if ! cmp -s "$SCRIPT_DIR/$artifact" "$LAYOUT_DIR/$artifact"; then
    echo "ERROR: Kitty native layout NOT VERIFIED: committed $SCRIPT_DIR/$artifact differs from the declared header build at $LAYOUT_DIR/$artifact." >&2
    exit 1
  fi
done
echo "Native layout and receipt match the declared header build."

# Find kitty binary
KITTY="${KITTY_BINARY:-}"
if [ -n "$KITTY" ] && [ ! -x "$KITTY" ]; then
  echo "ERROR: KITTY_BINARY is not executable: $KITTY" >&2
  exit 1
fi

if [ -z "$KITTY" ]; then
  for path in \
    "/Applications/kitty.app/Contents/MacOS/kitty" \
    "/usr/local/bin/kitty" \
    "/usr/bin/kitty" \
    "/opt/homebrew/bin/kitty"; do
    if [ -x "$path" ]; then
      KITTY="$path"
      break
    fi
  done
fi

if [ -z "$KITTY" ]; then
  KITTY=$(which kitty 2>/dev/null || true)
fi

if [ -z "$KITTY" ] || [ ! -x "$KITTY" ]; then
  echo "ERROR: kitty not found."
  echo ""
  echo "Install kitty:"
  echo "  brew install --cask kitty   # macOS"
  echo "  # or visit https://sw.kovidgoyal.net/kitty"
  exit 1
fi

echo "Found kitty: $KITTY"
"$KITTY" --version

# Verify kitty can import its fast_data_types module
echo "Verifying kitty Python environment..."
if ! verify_output=$("$KITTY" +runpy "from kitty.fast_data_types import Screen; print('OK')" 2>&1) ||
  ! grep -q OK <<< "$verify_output"; then
  echo "ERROR: kitty's Python environment is not working."
  echo "$verify_output" >&2
  echo "Try reinstalling kitty: brew reinstall --cask kitty"
  exit 1
fi

# Verify the bridge script exists
if [ ! -f "$SCRIPT_DIR/bridge.py" ]; then
  echo "ERROR: bridge.py not found at $SCRIPT_DIR/bridge.py"
  exit 1
fi

# Quick smoke test: init a screen and feed some text
echo "Running smoke test..."
RESULT=$("$KITTY" +runpy "import sys; sys.path.insert(0, '$SCRIPT_DIR'); import bridge; bridge.main()" <<'EOF'
{"op":"init","cols":80,"rows":24}
{"op":"feed","data":"SGVsbG8="}
{"op":"snapshot"}
{"op":"quit"}
EOF
)

if grep -q '"cursor"' <<< "$RESULT"; then
  echo "Smoke test passed."
else
  echo "ERROR: Smoke test failed."
  echo "Output: $RESULT"
  exit 1
fi

# Create a marker file so the backend registry knows we're ready
touch "$PKG_DIR/termless-kitty.node"

echo ""
echo "=== @termless/kitty ready ==="
echo "Kitty: $KITTY"
echo "Bridge: $SCRIPT_DIR/bridge.py"
