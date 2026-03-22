#!/bin/bash
# Build kitty's VT parser from source
#
# IMPORTANT: kitty is licensed under GPL-3.0. This script downloads and
# compiles kitty's source code on your machine. The resulting .node binary
# is a derivative work under GPL-3.0. It is NOT distributed — only built
# locally for testing purposes.
#
# Run: cd packages/kitty && bash build/build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/tmp"
KITTY_DIR="$BUILD_DIR/kitty"

echo "=== @termless/kitty build ==="
echo "NOTE: This downloads kitty (GPL-3.0) and builds locally."
echo "The .node binary is GPL-3.0 and must not be distributed."
echo ""

# Clone kitty if not present
if [ ! -d "$KITTY_DIR" ]; then
  echo "Cloning kitty..."
  mkdir -p "$BUILD_DIR"
  git clone --depth 1 https://github.com/kovidgoyal/kitty.git "$KITTY_DIR"
else
  echo "Using existing kitty clone at $KITTY_DIR"
fi

echo ""
echo "Kitty source available at: $KITTY_DIR"
echo ""
echo "TODO: Extract and compile VT parser. Kitty's parser is tightly"
echo "coupled to its rendering pipeline. A C wrapper needs to:"
echo "  1. Initialize kitty's screen/parser data structures"
echo "  2. Expose feed(bytes) -> parse and update screen"
echo "  3. Expose getCell(row, col) -> cell attributes"
echo "  4. Expose getCursor() -> cursor position"
echo ""
echo "Key source files:"
echo "  kitty/kitty/parser.c    — VT parser state machine"
echo "  kitty/kitty/screen.c    — screen buffer management"
echo "  kitty/kitty/data-types.h — core data types (Cell, Screen, etc.)"
echo "  kitty/kitty/lineops.h   — line operations"
echo ""
echo "This is a complex integration task due to kitty's architecture."
echo "The parser depends on Python (for code generation) and has many"
echo "internal dependencies. A simpler approach may be to use kitty's"
echo "built-in 'kitten' tool for testing, or to compile a minimal"
echo "subset of the parser."
echo ""
echo "Build not yet implemented — see README.md for status."
