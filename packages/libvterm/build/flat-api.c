#include "vterm.h"
#include "vterm_internal.h"
#include "utf8.h"
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

// The private state layout is tied to the libvterm revision pinned by build.sh.
int termless_vterm_state_get_application_cursor(const VTermState *state) {
  return state->mode.cursor;
}

int termless_vterm_state_get_application_keypad(const VTermState *state) {
  return state->mode.keypad;
}

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

// The headless embedder owns the clipboard; libvterm owns OSC parsing,
// base64 decoding and reply formatting. Reuse the output sink's byte storage
// for complete and in-progress selection data, without touching the OS clipboard.
typedef struct {
  TermlessOutputSink output; // First member preserves the existing opaque sink ABI.
  TermlessOutputSink clipboard;
  TermlessOutputSink staging;
  VTermState *state;
  char selection_buffer[4096];
} TermlessSelectionHost;

static int selection_set(VTermSelectionMask mask, VTermStringFragment frag, void *user) {
  TermlessSelectionHost *host = user;
  if (!(mask & VTERM_SELECTION_CLIPBOARD)) return 0;
  if (frag.initial) host->staging.len = 0;
  if (frag.len) sink_output(frag.str, frag.len, &host->staging);
  if (host->staging.failed) {
    host->output.failed = 1;
    return 0;
  }
  if (frag.final) {
    TermlessOutputSink previous = host->clipboard;
    host->clipboard = host->staging;
    host->staging = previous;
    host->staging.len = 0;
  }
  return 1;
}

static int selection_query(VTermSelectionMask mask, void *user) {
  TermlessSelectionHost *host = user;
  if (!(mask & VTERM_SELECTION_CLIPBOARD) || host->output.failed) return 0;
  vterm_state_send_selection(host->state, VTERM_SELECTION_CLIPBOARD, (VTermStringFragment){
    .str = host->clipboard.bytes,
    .len = host->clipboard.len,
    .initial = 1,
    .final = 1,
  });
  return 1;
}

static const VTermSelectionCallbacks selection_callbacks = {
  .set = selection_set,
  .query = selection_query,
};

TermlessOutputSink *termless_vterm_output_attach(VTerm *vt) {
  TermlessSelectionHost *host = calloc(1, sizeof *host);
  if (!host) return NULL;
  host->state = vterm_obtain_state(vt);
  vterm_output_set_callback(vt, sink_output, &host->output);
  vterm_state_set_selection_callbacks(host->state, &selection_callbacks, host,
      host->selection_buffer, sizeof host->selection_buffer);
  return &host->output;
}

// Capture synchronous native input without changing the selection owner.
TermlessOutputSink *termless_vterm_output_capture_begin(VTerm *vt) {
  TermlessOutputSink *capture = calloc(1, sizeof *capture);
  if (!capture) return NULL;
  vterm_output_set_callback(vt, sink_output, capture);
  return capture;
}

void termless_vterm_output_capture_end(VTerm *vt, TermlessOutputSink *reply,
    TermlessOutputSink *capture) {
  vterm_output_set_callback(vt, sink_output, reply);
  free(capture->bytes);
  free(capture);
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
  TermlessSelectionHost *host = (TermlessSelectionHost *)sink;
  vterm_state_set_selection_callbacks(host->state, NULL, NULL, NULL, 0);
  vterm_output_set_callback(vt, NULL, NULL);
  free(sink->bytes);
  free(host->clipboard.bytes);
  free(host->staging.bytes);
  free(host);
}

// Per-screen fixed-width observation record: visible, shape, blink at offsets 0..2,
// plus engine-delivered VTERM_PROP_TITLE fragments accumulated per libvterm's
// VTermStringFragment initial/final contract. The callback runs before libvterm
// stores the property, so read val.
typedef struct {
  char *value;
  size_t len;
  size_t cap;
  char *staging;
  size_t staging_len;
  size_t staging_cap;
} TermlessStringProp;

typedef struct {
  int32_t visible;
  int32_t shape;
  int32_t blink;
  TermlessStringProp title;
  int32_t reverse; // Appended after the existing title fields (WASM32 byte offset 36).
  TermlessStringProp icon;
  int32_t failed;
} TermlessPropRecord;

_Static_assert(offsetof(TermlessPropRecord, reverse) == 36, "property prefix ABI changed");
_Static_assert(offsetof(TermlessPropRecord, failed) == 64, "property failure ABI changed");
_Static_assert(sizeof(TermlessPropRecord) == 68, "property record ABI changed");

typedef struct {
  int cols;
  VTermScreenCell *cells;
} TermlessHistoryRow;

typedef struct {
  TermlessPropRecord props; // Existing 68-byte WASM32 prefix, owned by C.
  VTermState *state;
  TermlessHistoryRow *rows;
  int count;
  int limit;
  int reflow;
} TermlessObserver;

static void clear_history(TermlessObserver *observer) {
  for (int row = 0; row < observer->count; row++) free(observer->rows[row].cells);
  free(observer->rows);
  observer->rows = NULL;
  observer->count = 0;
}

static int history_clear(void *user) {
  clear_history(user);
  return 1;
}

static int history_push(int cols, const VTermScreenCell *cells, void *user) {
  TermlessObserver *observer = user;
  if (observer->props.failed) return 0;
  if (!observer->limit) return 1;
  if (cols < 0 || (size_t)cols > SIZE_MAX / sizeof(*cells)) goto failed;
  VTermScreenCell *copy = malloc((size_t)cols * sizeof(*cells));
  if (!copy && cols) goto failed;
  if (cols) memcpy(copy, cells, (size_t)cols * sizeof(*cells));
  if (!observer->rows) {
    if ((size_t)observer->limit > SIZE_MAX / sizeof(*observer->rows)) { free(copy); goto failed; }
    observer->rows = calloc((size_t)observer->limit, sizeof(*observer->rows));
    if (!observer->rows) { free(copy); goto failed; }
  }
  if (observer->count == observer->limit) {
    free(observer->rows[0].cells);
    memmove(observer->rows, observer->rows + 1, (size_t)(--observer->count) * sizeof(*observer->rows));
  }
  observer->rows[observer->count++] = (TermlessHistoryRow){ .cols = cols, .cells = copy };
  return 1;
failed:
  observer->props.failed = 1;
  return 0;
}

static int history_pop(int cols, VTermScreenCell *cells, void *user) {
  TermlessObserver *observer = user;
  if (observer->props.failed || !observer->count) return 0;
  TermlessHistoryRow row = observer->rows[--observer->count];
  VTermScreenCell blank = { .width = 1 };
  vterm_state_get_default_colors(observer->state, &blank.fg, &blank.bg);
  blank.fg.type |= VTERM_COLOR_DEFAULT_FG;
  blank.bg.type |= VTERM_COLOR_DEFAULT_BG;
  for (int col = 0; col < cols; col++) {
    cells[col] = col < row.cols ? row.cells[col] : blank;
    if (cells[col].width == 0 || (col == cols - 1 && cells[col].width == 2)) cells[col] = blank;
  }
  free(row.cells);
  return 1;
}

TermlessObserver *termless_vterm_observer_new(VTermState *state, int limit) {
  if (!state || limit < 0) return NULL;
  TermlessObserver *observer = calloc(1, sizeof(*observer));
  if (observer) { observer->state = state; observer->limit = limit; }
  return observer;
}

static void clear_string_prop(TermlessStringProp *rec) {
  free(rec->value);
  free(rec->staging);
  memset(rec, 0, sizeof(*rec));
}

static int observe_string_prop(TermlessStringProp *rec, VTermStringFragment frag) {
  if (frag.initial) rec->staging_len = 0;
  if (frag.len > SIZE_MAX - rec->staging_len - 1) return 0;
  size_t needed = rec->staging_len + frag.len;
  if (needed > rec->staging_cap) {
    size_t cap = rec->staging_cap ? rec->staging_cap : 64;
    while (cap < needed) {
      if (cap > SIZE_MAX / 2) { cap = needed; break; }
      cap *= 2;
    }
    char *grown = realloc(rec->staging, cap);
    if (!grown) return 0;
    rec->staging = grown;
    rec->staging_cap = cap;
  }
  if (frag.len) memcpy(rec->staging + rec->staging_len, frag.str, frag.len);
  rec->staging_len = needed;
  if (frag.final) {
    if (needed + 1 > rec->cap) {
      char *grown = realloc(rec->value, needed + 1);
      if (!grown) return 0;
      rec->value = grown;
      rec->cap = needed + 1;
    }
    if (needed) memcpy(rec->value, rec->staging, needed);
    rec->value[needed] = '\0';
    rec->len = needed;
  }
  return 1;
}

static int observe_termprop(VTermProp prop, VTermValue *val, void *user) {
  TermlessPropRecord *rec = user;
  switch (prop) {
    case VTERM_PROP_CURSORVISIBLE: rec->visible = val->boolean; break;
    case VTERM_PROP_CURSORSHAPE: rec->shape = val->number; break;
    case VTERM_PROP_CURSORBLINK: rec->blink = val->boolean; break;
    case VTERM_PROP_REVERSE: rec->reverse = val->boolean; break;
    case VTERM_PROP_TITLE:
    case VTERM_PROP_ICONNAME:
      if (!rec->failed && !observe_string_prop(
          prop == VTERM_PROP_TITLE ? &rec->title : &rec->icon, val->string)) rec->failed = 1;
      break;
    default: break;
  }
  // Returning zero would veto native property storage, including properties
  // this observer does not expose (alternate screen, etc.).
  return 1;
}

static const VTermScreenCallbacks observer_callbacks = {
  .settermprop = observe_termprop,
  .sb_pushline = history_push,
  .sb_popline = history_pop,
  .sb_clear = history_clear,
};

void termless_vterm_screen_observe_props(VTermScreen *screen, int32_t *record) {
  if (screen && record) {
    TermlessPropRecord *rec = (TermlessPropRecord *)record;
    clear_history((TermlessObserver *)record);
    clear_string_prop(&rec->title);
    clear_string_prop(&rec->icon);
    memset(rec, 0, sizeof(*rec));
    rec->visible = rec->shape = rec->blink = rec->reverse = -1;
    vterm_screen_set_callbacks(screen, &observer_callbacks, rec);
  } else if (screen) {
    vterm_screen_set_callbacks(screen, NULL, NULL);
  } else if (record) {
    TermlessPropRecord *rec = (TermlessPropRecord *)record;
    // Reset preserves the existing title/icon cleanup contract, while history
    // changes only when the engine invokes sb_clear (or the owner is freed).
    clear_string_prop(&rec->title);
    clear_string_prop(&rec->icon);
  }
}

void termless_vterm_observer_free(TermlessObserver *observer) {
  if (!observer) return;
  clear_history(observer);
  clear_string_prop(&observer->props.title);
  clear_string_prop(&observer->props.icon);
  free(observer);
}

void termless_vterm_observer_enable_reflow(VTermScreen *screen, TermlessObserver *observer) {
  vterm_screen_enable_reflow(screen, 1);
  observer->reflow = 1;
}

int termless_vterm_observer_get_reflow(const TermlessObserver *observer) { return observer->reflow; }
int termless_vterm_history_count(const TermlessObserver *observer) { return observer->count; }
int termless_vterm_history_cols(const TermlessObserver *observer, int row) {
  return row >= 0 && row < observer->count ? observer->rows[row].cols : 0;
}

const char *termless_vterm_screen_get_title(const int32_t *record) {
  if (!record) return "";
  const TermlessPropRecord *rec = (const TermlessPropRecord *)record;
  return rec->title.value ? rec->title.value : "";
}

int termless_vterm_screen_get_title_len(const int32_t *record) {
  if (!record) return 0;
  const TermlessPropRecord *rec = (const TermlessPropRecord *)record;
  return (int)rec->title.len;
}

const char *termless_vterm_screen_get_icon(const int32_t *record) {
  const TermlessPropRecord *rec = (const TermlessPropRecord *)record;
  return rec->icon.value ? rec->icon.value : "";
}

int termless_vterm_screen_get_icon_len(const int32_t *record) {
  return (int)((const TermlessPropRecord *)record)->icon.len;
}

static void serialize_cell(const VTermScreenCell *cell, uint32_t *out) {
  // Our own fixed-width output ABI. Never expose libvterm's bitfield/union
  // layout to JavaScript; it can differ by compiler or upstream revision.
  out[0] = cell->chars[0];
  out[1] = (unsigned char)cell->width;
  out[2] = cell->attrs.bold;
  out[3] = cell->attrs.underline;
  out[4] = cell->attrs.italic;
  out[5] = cell->attrs.blink;
  out[6] = cell->attrs.reverse;
  out[7] = cell->attrs.conceal;
  out[8] = cell->attrs.strike;
  out[9] = cell->fg.type;
  out[10] = cell->fg.rgb.red;
  out[11] = cell->fg.rgb.green;
  out[12] = cell->fg.rgb.blue;
  out[13] = cell->bg.type;
  out[14] = cell->bg.rgb.red;
  out[15] = cell->bg.rgb.green;
  out[16] = cell->bg.rgb.blue;
}

// Emscripten cwrap accepts scalar arguments; libvterm's cell/text APIs take
// small structs by value, whose C ABI cannot be expressed by cwrap directly.
int termless_vterm_screen_get_cell_flat(const VTermScreen *screen, int row, int col, uint32_t *out) {
  VTermScreenCell cell;
  memset(&cell, 0, sizeof(cell));
  memset(out, 0, 17 * sizeof(uint32_t));
  int found = vterm_screen_get_cell(screen, (VTermPos){ .row = row, .col = col }, &cell);
  if (!found) return found;

  serialize_cell(&cell, out);
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

int termless_vterm_history_get_cell_flat(const TermlessObserver *observer, int row, int col, uint32_t *out) {
  memset(out, 0, 17 * sizeof(*out));
  if (row < 0 || row >= observer->count || col < 0 || col >= observer->rows[row].cols) return 0;
  serialize_cell(&observer->rows[row].cells[col], out);
  return 1;
}

// Return the complete byte count even when the caller's buffer is smaller.
int termless_vterm_history_get_text(const TermlessObserver *observer, int row, int start_col, int end_col, char *buf, int len) {
  if (row < 0 || row >= observer->count) return 0;
  const TermlessHistoryRow *line = &observer->rows[row];
  size_t used = 0;
  if (start_col < 0) start_col = 0;
  if (end_col > line->cols) end_col = line->cols;
  for (int col = start_col; col < end_col; col++) {
    const VTermScreenCell *cell = &line->cells[col];
    if (cell->chars[0] == UINT32_MAX) continue;
    for (int i = 0; i < VTERM_MAX_CHARS_PER_CELL; i++) {
      uint32_t cp = cell->chars[i];
      if (!cp && i) break;
      if (!cp) cp = ' ';
      // Use the pinned engine's encoder, as screen.c does; no second UTF-8 path.
      const size_t n = utf8_seqlen(cp);
      if (len > 0 && used + n <= (size_t)len) fill_utf8(cp, buf + used);
      used += n;
      if (!cell->chars[0]) break;
    }
  }
  return (int)used;
}
