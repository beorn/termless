#!/bin/bash
# Build libvterm to WASM via Emscripten
# Requires: emscripten SDK (emcc)
#
# Run: cd packages/libvterm && bash build/build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="${TERMLESS_LIBVTERM_BUILD_DIR:-$SCRIPT_DIR/tmp}"
WASM_DIR="$PKG_DIR/wasm"
LIBVTERM_TAG="v0.3.3"
LIBVTERM_COMMIT="9d6d2112335080312ef8c36667fa717ded4f7daf"

# Clone libvterm if not present
if [ ! -d "$BUILD_DIR/libvterm" ]; then
  echo "Cloning libvterm..."
  mkdir -p "$BUILD_DIR"
  git clone --depth 1 --branch "$LIBVTERM_TAG" \
    https://github.com/neovim/libvterm.git "$BUILD_DIR/libvterm"
fi

cd "$BUILD_DIR/libvterm"
ACTUAL_COMMIT="$(git rev-parse HEAD)"
if [ "$ACTUAL_COMMIT" != "$LIBVTERM_COMMIT" ]; then
  echo "ERROR: libvterm source is $ACTUAL_COMMIT; expected $LIBVTERM_TAG at $LIBVTERM_COMMIT" >&2
  exit 1
fi

# Upstream's selection encoder promotes signed char bytes before base64.
# The declared patch keeps non-ASCII clipboard bytes intact; the receipt binds
# this build subtree and requires precisely this upstream source difference.
if git apply --reverse --check "$SCRIPT_DIR/selection-bytes.patch" 2>/dev/null; then
  echo "libvterm selection-byte patch already applied"
else
  git apply "$SCRIPT_DIR/selection-bytes.patch"
fi

echo "Building libvterm with Emscripten..."

# Release source keeps encoding tables as .tbl files; the upstream Makefile
# generates the C includes before compiling encoding.c.
make src/encoding/DECdrawing.inc src/encoding/uk.inc src/fullwidth.inc

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
emcc -O2 -I include -I src -c "$SCRIPT_DIR/flat-api.c" -o "$BUILD_DIR/obj/flat-api.o"

# Link into WASM module with exported functions
mkdir -p "$WASM_DIR"
# LLVM treats '%' in absolute output paths as a temporary-file placeholder.
cd "$WASM_DIR"

emcc -O2 \
  "$BUILD_DIR"/obj/*.o \
  -s EXPORTED_FUNCTIONS='[
    "_termless_vterm_new_utf8",
    "_vterm_free",
    "_vterm_set_size",
    "_vterm_input_write",
    "_vterm_keyboard_unichar",
    "_vterm_keyboard_key",
    "_vterm_keyboard_start_paste",
    "_vterm_keyboard_end_paste",
    "_vterm_mouse_move",
    "_vterm_mouse_button",
    "_termless_vterm_output_capture_begin",
    "_termless_vterm_output_capture_end",
    "_termless_vterm_output_attach",
    "_termless_vterm_output_read",
    "_termless_vterm_output_detach",
    "_vterm_obtain_screen",
    "_vterm_screen_reset",
    "_vterm_screen_enable_altscreen",
    "_vterm_screen_get_cell",
    "_vterm_screen_get_text",
    "_termless_vterm_screen_get_cell_flat",
    "_termless_vterm_screen_get_text_flat",
    "_termless_vterm_observer_new",
    "_termless_vterm_observer_free",
    "_termless_vterm_observer_enable_reflow",
    "_termless_vterm_observer_get_reflow",
    "_termless_vterm_history_count",
    "_termless_vterm_notification_count",
    "_termless_vterm_notification_get",
    "_termless_vterm_notification_len",
    "_termless_vterm_osc777_count",
    "_termless_vterm_osc777_get",
    "_termless_vterm_osc777_len",
    "_termless_vterm_history_cols",
    "_termless_vterm_history_get_cell_flat",
    "_termless_vterm_history_get_text",
    "_termless_vterm_state_get_application_keypad",
    "_termless_vterm_screen_observe_props",
    "_termless_vterm_screen_get_title",
    "_termless_vterm_screen_get_title_len",
    "_termless_vterm_screen_get_icon",
    "_termless_vterm_screen_get_icon_len",
    "_vterm_state_get_cursorpos",
    "_termless_vterm_state_get_application_cursor",
    "_vterm_obtain_state",
    "_vterm_screen_set_callbacks",
    "_malloc",
    "_free"
  ]' \
  -s EXPORTED_RUNTIME_METHODS='["cwrap", "ccall", "getValue", "setValue", "UTF8ToString", "stringToUTF8", "lengthBytesUTF8"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME="createLibvtermModule" \
  -s ENVIRONMENT='node' \
  -o libvterm.js

bun "$SCRIPT_DIR/write-receipt.ts" "$BUILD_DIR/libvterm" "$WASM_DIR/libvterm.wasm" "$WASM_DIR/libvterm.js"

echo "Built: $WASM_DIR/libvterm.js + libvterm.wasm"
echo "Done!"
