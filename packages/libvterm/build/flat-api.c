#include "vterm.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// TerminalBackend accepts UTF-8 bytes; libvterm itself defaults to legacy
// single-byte input. Select the encoding before state/screen initialization.
VTerm *termless_vterm_new_utf8(int rows, int cols) {
  VTerm *vt = vterm_new(rows, cols);
  if (vt) vterm_set_utf8(vt, 1);
  return vt;
}

// libvterm drops a whole reply once its fixed output buffer (4096 bytes by
// default) is full (vterm.c vterm_push_output_bytes). With an output callback
// it hands every reply over instead; this sink keeps them in order until the
// adapter reads them. Replies longer than libvterm's own 4096-byte formatting
// buffer never reach the callback, and the sink cannot change that.
typedef struct {
  char *bytes;
  size_t len;
  size_t cap;
  int failed;
} TermlessOutputSink;

static void sink_output(const char *bytes, size_t len, void *user) {
  TermlessOutputSink *sink = user;
  if (sink->failed) return;
  if (len > sink->cap - sink->len) {
    size_t cap = sink->cap ? sink->cap : 4096;
    while (len > cap - sink->len) {
      if (cap > SIZE_MAX / 2) { sink->failed = 1; return; }
      cap *= 2;
    }
    char *grown = realloc(sink->bytes, cap);
    if (!grown) { sink->failed = 1; return; }
    sink->bytes = grown;
    sink->cap = cap;
  }
  memcpy(sink->bytes + sink->len, bytes, len);
  sink->len += len;
}

TermlessOutputSink *termless_vterm_output_attach(VTerm *vt) {
  TermlessOutputSink *sink = calloc(1, sizeof *sink);
  if (sink) vterm_output_set_callback(vt, sink_output, sink);
  return sink;
}

// Copies up to len pending reply bytes in order and removes them from the sink.
// Returns -1 once an allocation failure has lost a reply; it never recovers.
int termless_vterm_output_read(TermlessOutputSink *sink, char *buf, int len) {
  if (sink->failed) return -1;
  size_t n = sink->len < (size_t)len ? sink->len : (size_t)len;
  memcpy(buf, sink->bytes, n);
  memmove(sink->bytes, sink->bytes + n, sink->len - n);
  sink->len -= n;
  return (int)n;
}

void termless_vterm_output_detach(VTerm *vt, TermlessOutputSink *sink) {
  vterm_output_set_callback(vt, NULL, NULL);
  free(sink->bytes);
  free(sink);
}

// Per-screen fixed-width observation record: visible, shape, blink at offsets 0..2,
// plus engine-delivered VTERM_PROP_TITLE fragments accumulated per libvterm's
// VTermStringFragment initial/final contract. The callback runs before libvterm
// stores the property, so read val.
typedef struct {
  int32_t visible;
  int32_t shape;
  int32_t blink;
  char *title;
  size_t title_len;
  size_t title_cap;
  char *staging;
  size_t staging_len;
  size_t staging_cap;
} TermlessPropRecord;

static void clear_prop_title(TermlessPropRecord *rec) {
  free(rec->title);
  free(rec->staging);
  rec->title = NULL;
  rec->title_len = 0;
  rec->title_cap = 0;
  rec->staging = NULL;
  rec->staging_len = 0;
  rec->staging_cap = 0;
}

static int observe_termprop(VTermProp prop, VTermValue *val, void *user) {
  TermlessPropRecord *rec = user;
  switch (prop) {
    case VTERM_PROP_CURSORVISIBLE: rec->visible = val->boolean; break;
    case VTERM_PROP_CURSORSHAPE: rec->shape = val->number; break;
    case VTERM_PROP_CURSORBLINK: rec->blink = val->boolean; break;
    case VTERM_PROP_TITLE: {
      VTermStringFragment frag = val->string;
      if (frag.initial) rec->staging_len = 0;
      if (frag.len > 0) {
        size_t needed = rec->staging_len + frag.len;
        if (needed > rec->staging_cap) {
          size_t cap = rec->staging_cap ? rec->staging_cap : 64;
          while (cap < needed) cap *= 2;
          char *grown = realloc(rec->staging, cap);
          if (!grown) return 1;
          rec->staging = grown;
          rec->staging_cap = cap;
        }
        memcpy(rec->staging + rec->staging_len, frag.str, frag.len);
        rec->staging_len = needed;
      }
      if (frag.final) {
        size_t needed = rec->staging_len + 1;
        if (needed > rec->title_cap) {
          char *grown = realloc(rec->title, needed);
          if (!grown) return 1;
          rec->title = grown;
          rec->title_cap = needed;
        }
        if (rec->staging_len > 0) memcpy(rec->title, rec->staging, rec->staging_len);
        rec->title[rec->staging_len] = '\0';
        rec->title_len = rec->staging_len;
      }
      break;
    }
    default: break;
  }
  // Returning zero would veto native property storage, including properties
  // this observer does not expose (reverse, alternate screen, title, etc.).
  return 1;
}

static const VTermScreenCallbacks observer_callbacks = {
  .settermprop = observe_termprop,
};

void termless_vterm_screen_observe_props(VTermScreen *screen, int32_t *record) {
  if (screen && record) {
    TermlessPropRecord *rec = (TermlessPropRecord *)record;
    memset(rec, 0, sizeof(*rec));
    rec->visible = rec->shape = rec->blink = -1;
    vterm_screen_set_callbacks(screen, &observer_callbacks, rec);
  } else if (screen) {
    vterm_screen_set_callbacks(screen, NULL, NULL);
  } else if (record) {
    clear_prop_title((TermlessPropRecord *)record);
  }
}

const char *termless_vterm_screen_get_title(const int32_t *record) {
  if (!record) return "";
  const TermlessPropRecord *rec = (const TermlessPropRecord *)record;
  return rec->title ? rec->title : "";
}

int termless_vterm_screen_get_title_len(const int32_t *record) {
  if (!record) return 0;
  const TermlessPropRecord *rec = (const TermlessPropRecord *)record;
  return (int)rec->title_len;
}

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
