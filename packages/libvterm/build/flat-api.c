#include "vterm.h"
#include <stdint.h>
#include <string.h>

// Emscripten cwrap accepts scalar arguments; libvterm's cell/text APIs take
// small structs by value, whose C ABI cannot be expressed by cwrap directly.
int termless_vterm_screen_get_cell_flat(const VTermScreen *screen, int row, int col, uint32_t *out) {
  VTermScreenCell cell;
  memset(&cell, 0, sizeof(cell));
  memset(out, 0, 17 * sizeof(uint32_t));
  int found = vterm_screen_get_cell(screen, (VTermPos){ .row = row, .col = col }, &cell);
  if (!found) return found;

  // Our own fixed-width output ABI. Never expose libvterm's bitfield/union
  // layout to JavaScript; it can differ by compiler or upstream revision.
  out[0] = cell.chars[0];
  out[1] = (unsigned char)cell.width;
  out[2] = cell.attrs.bold;
  out[3] = cell.attrs.underline;
  out[4] = cell.attrs.italic;
  out[5] = cell.attrs.blink;
  out[6] = cell.attrs.reverse;
  out[7] = cell.attrs.conceal;
  out[8] = cell.attrs.strike;
  out[9] = cell.fg.type;
  out[10] = cell.fg.rgb.red;
  out[11] = cell.fg.rgb.green;
  out[12] = cell.fg.rgb.blue;
  out[13] = cell.bg.type;
  out[14] = cell.bg.rgb.red;
  out[15] = cell.bg.rgb.green;
  out[16] = cell.bg.rgb.blue;
  return found;
}

size_t termless_vterm_screen_get_text_flat(
  const VTermScreen *screen, char *text, size_t len,
  int start_row, int start_col, int end_row, int end_col
) {
  return vterm_screen_get_text(screen, text, len, (VTermRect){
    .start_row = start_row,
    .end_row = end_row,
    .start_col = start_col,
    .end_col = end_col,
  });
}
