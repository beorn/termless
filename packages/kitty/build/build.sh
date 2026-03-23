#!/bin/bash
# Verify kitty installation for the @termless/kitty backend.
#
# Unlike other native backends, kitty doesn't require compilation. It uses
# kitty's installed binary (`kitty +runpy`) as a Python subprocess bridge
# to access kitty's VT parser directly.
#
# IMPORTANT: kitty is licensed under GPL-3.0. This backend runs kitty's own
# code in a subprocess — no derivative binaries are produced or distributed.
#
# Run: cd packages/kitty && bash build/build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== @termless/kitty build ==="
echo "NOTE: This backend uses kitty's installed binary (GPL-3.0)."
echo "No compilation needed — kitty must be installed separately."
echo ""

# Find kitty binary
KITTY=""
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

# Verify kitty can import its fast_data_types module
echo "Verifying kitty Python environment..."
if ! "$KITTY" +runpy "from kitty.fast_data_types import Screen; print('OK')" 2>/dev/null | grep -q OK; then
  echo "ERROR: kitty's Python environment is not working."
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
{"op":"quit"}
EOF
)

if echo "$RESULT" | grep -q '"cursor"'; then
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
