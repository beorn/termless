#!/bin/bash
# Build libvterm to WASM via Emscripten
# Requires: emscripten SDK (emcc)
#
# Run: cd packages/libvterm && bash build/build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/tmp"
WASM_DIR="$PKG_DIR/wasm"

# Clone libvterm if not present
if [ ! -d "$BUILD_DIR/libvterm" ]; then
  echo "Cloning libvterm..."
  mkdir -p "$BUILD_DIR"
  git clone https://github.com/neovim/libvterm.git "$BUILD_DIR/libvterm"
fi

cd "$BUILD_DIR/libvterm"

echo "Building libvterm with Emscripten..."

# Compile all libvterm source files to object files
SOURCES=(
  src/encoding.c
  src/keyboard.c
  src/mouse.c
  src/parser.c
  src/pen.c
  src/screen.c
  src/state.c
  src/unicode.c
  src/vterm.c
)

mkdir -p "$BUILD_DIR/obj"

for src in "${SOURCES[@]}"; do
  obj="$BUILD_DIR/obj/$(basename "$src" .c).o"
  emcc -O2 -I include -c "$src" -o "$obj"
done

# Link into WASM module with exported functions
mkdir -p "$WASM_DIR"

emcc -O2 \
  "$BUILD_DIR"/obj/*.o \
  -s EXPORTED_FUNCTIONS='[
    "_vterm_new",
    "_vterm_free",
    "_vterm_set_size",
    "_vterm_input_write",
    "_vterm_obtain_screen",
    "_vterm_screen_reset",
    "_vterm_screen_enable_altscreen",
    "_vterm_screen_get_cell",
    "_vterm_screen_get_text",
    "_vterm_state_get_cursorpos",
    "_vterm_obtain_state",
    "_vterm_screen_set_callbacks",
    "_malloc",
    "_free"
  ]' \
  -s EXPORTED_RUNTIME_METHODS='["cwrap", "ccall", "getValue", "setValue", "UTF8ToString", "stringToUTF8", "lengthBytesUTF8"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="createLibvtermModule" \
  -s ENVIRONMENT='node' \
  -o "$WASM_DIR/libvterm.js"

echo "Built: $WASM_DIR/libvterm.js + libvterm.wasm"
echo "Done!"
