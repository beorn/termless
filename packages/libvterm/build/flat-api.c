#include "vterm.h"
#include "vterm_internal.h"
#include "utf8.h"
#include <stdint.h>
#include <limits.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// The private state layout is tied to the libvterm revision pinned by build.sh.
int termless_vterm_state_get_application_cursor(const VTermState *state) {
  return state->mode.cursor;
}

int termless_vterm_state_get_application_keypad(const VTermState *state) {
  return state->mode.keypad;
}

int termless_vterm_state_get_mouse_tracking(const VTermState *state) {
  return state->mouse_flags;
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
  TermlessStringProp staging;
  TermlessStringProp *entries;
  int count;
  int cap;
} TermlessNotificationHistory;

typedef struct {
  const char *kind;
  char *code;
} TermlessUnhandledSequence;

typedef struct {
  TermlessPropRecord props; // Existing 68-byte WASM32 prefix, owned by C.
  VTermState *state;
  TermlessHistoryRow *rows;
  int count;
  int limit;
  int reflow;
  TermlessNotificationHistory notifications[2]; // OSC 9 and OSC 777 share one owner.
  TermlessStringProp cwd_payload; // Complete public OSC callback payload, before 633 property selection.
  TermlessStringProp cwd;
  TermlessUnhandledSequence *unhandled;
  int unhandled_count;
  int unhandled_cap;
} TermlessObserver;

_Static_assert(offsetof(TermlessObserver, state) == 68, "observer property prefix ABI changed");

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

static int observe_osc(int command, VTermStringFragment frag, void *user);
static int observe_csi(const char *leader, const long args[], int argcount, const char *intermed, char command, void *user);
static int observe_apc(VTermStringFragment frag, void *user);
static const VTermStateFallbacks observer_fallbacks = {
  .osc = observe_osc, .csi = observe_csi, .apc = observe_apc,
};

TermlessObserver *termless_vterm_observer_new(VTermState *state, int limit) {
  if (!state || limit < 0) return NULL;
  TermlessObserver *observer = calloc(1, sizeof(*observer));
  if (observer) {
    observer->state = state;
    observer->limit = limit;
    vterm_state_set_unrecognised_fallbacks(state, &observer_fallbacks, observer);
  }
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

static void clear_notifications(TermlessObserver *observer) {
  for (int i = 0; i < observer->unhandled_count; i++) free(observer->unhandled[i].code);
  free(observer->unhandled);
  observer->unhandled = NULL;
  observer->unhandled_count = observer->unhandled_cap = 0;
  for (int family = 0; family < 2; family++) {
    TermlessNotificationHistory *history = &observer->notifications[family];
    clear_string_prop(&history->staging);
    for (int i = 0; i < history->count; i++) clear_string_prop(&history->entries[i]);
    free(history->entries);
    memset(history, 0, sizeof(*history));
  }
}

static void clear_cwd(TermlessObserver *observer) {
  clear_string_prop(&observer->cwd_payload);
  clear_string_prop(&observer->cwd);
}

// One arrival-ordered owner, with the existing INT_MAX bound and failure flag.
// Takes ownership even on failure; none of the records retain string payloads.
static void record_unhandled(TermlessObserver *observer, const char *kind, char *code) {
  if (!code || observer->props.failed || observer->unhandled_count == INT_MAX) goto failed;
  if (observer->unhandled_count == observer->unhandled_cap) {
    int cap = observer->unhandled_cap ? observer->unhandled_cap : 8;
    if (observer->unhandled_cap) cap = cap > INT_MAX / 2 ? INT_MAX : cap * 2;
    TermlessUnhandledSequence *grown = (size_t)cap > SIZE_MAX / sizeof(*grown) ? NULL :
      realloc(observer->unhandled, (size_t)cap * sizeof(*grown));
    if (!grown) goto failed;
    observer->unhandled = grown;
    observer->unhandled_cap = cap;
  }
  observer->unhandled[observer->unhandled_count++] = (TermlessUnhandledSequence){ kind, code };
  return;
failed:
  free(code);
  observer->props.failed = 1;
}

static int observe_csi(const char *leader, const long args[], int argcount, const char *intermed, char command, void *user) {
  TermlessObserver *observer = user;
  if (observer->props.failed) return 0;
  size_t leader_len = leader ? strlen(leader) : 0;
  size_t intermed_len = intermed ? strlen(intermed) : 0;
  // A decimal long plus separator fits this per-argument allocation. The
  // public parser supplies bounded leader/intermediate strings and argcount.
  size_t capacity = leader_len + intermed_len + (size_t)argcount * (sizeof(long) * 3 + 2) + 2;
  char *code = malloc(capacity);
  if (code) {
    size_t offset = 0;
    if (leader_len) { memcpy(code, leader, leader_len); offset += leader_len; }
    if (intermed_len) { memcpy(code + offset, intermed, intermed_len); offset += intermed_len; }
    for (int i = 0; i < argcount; i++) {
      if (i) code[offset++] = CSI_ARG_HAS_MORE(args[i - 1]) ? ':' : ';';
      offset += (size_t)snprintf(code + offset, capacity - offset, "%ld", (long)CSI_ARG_OR(args[i], 0));
    }
    code[offset++] = command;
    code[offset] = '\0';
  }
  record_unhandled(observer, "csi", code);
  return 0;
}

static int observe_apc(VTermStringFragment frag, void *user) {
  if (!frag.initial) return 0;
  char *code = malloc(2);
  if (code) { code[0] = frag.len ? frag.str[0] : '\0'; code[1] = '\0'; }
  record_unhandled(user, "apc", code);
  return 0;
}

static int observe_osc(int command, VTermStringFragment frag, void *user) {
  TermlessObserver *observer = user;
  // Preserve the first-fragment report and existing OSC delivery return policy.
  if (frag.initial && !observer->props.failed) {
    char *code = malloc(sizeof(int) * 3 + 2);
    if (code) snprintf(code, sizeof(int) * 3 + 2, "%d", command);
    record_unhandled(observer, "osc", code);
  }
  if (command != 7 && command != 633 && command != 9 && command != 777) return 0;
  if (observer->props.failed) return 1;
  if (command == 7 || command == 633) {
    TermlessStringProp *payload = &observer->cwd_payload;
    size_t previous = frag.initial ? 0 : payload->staging_len;
    if (frag.len > (size_t)INT_MAX - previous || !observe_string_prop(payload, frag)) goto failed;
    if (!frag.final) return 1;
    size_t offset = 0;
    if (command == 633) {
      if (payload->len < 6 || memcmp(payload->value, "P;Cwd=", 6)) return 1;
      offset = 6;
    }
    size_t len = payload->len - offset;
    if (!len) clear_string_prop(&observer->cwd);
    else if (!observe_string_prop(&observer->cwd, (VTermStringFragment){
      .str = payload->value + offset, .len = len, .initial = 1, .final = 1,
    })) goto failed;
    return 1;
  }
  TermlessNotificationHistory *history = &observer->notifications[command == 777];
  TermlessStringProp *rec = &history->staging;
  // observe_string_prop resets staging on initial, including after CAN/SUB.
  size_t previous = frag.initial ? 0 : rec->staging_len;
  if (frag.len > (size_t)INT_MAX - previous || !observe_string_prop(rec, frag)) goto failed;
  if (!frag.final) return 1;
  if (history->count == INT_MAX) goto failed;
  if (history->count == history->cap) {
    int cap = history->cap ? history->cap : 8;
    if (history->cap) cap = cap > INT_MAX / 2 ? INT_MAX : cap * 2;
    if ((size_t)cap > SIZE_MAX / sizeof(*history->entries)) goto failed;
    TermlessStringProp *grown = realloc(history->entries, (size_t)cap * sizeof(*grown));
    if (!grown) goto failed;
    history->entries = grown;
    history->cap = cap;
  }
  // Transfer the complete value; keep only the reusable fragment staging buffer.
  history->entries[history->count++] = (TermlessStringProp){
    .value = rec->value, .len = rec->len, .cap = rec->cap,
  };
  rec->value = NULL;
  rec->len = rec->cap = 0;
  return 1;
failed:
  observer->props.failed = 1;
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
    clear_notifications((TermlessObserver *)record);
    clear_cwd((TermlessObserver *)record);
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
    clear_notifications((TermlessObserver *)record);
    clear_cwd((TermlessObserver *)record);
  }
}

void termless_vterm_observer_free(TermlessObserver *observer) {
  if (!observer) return;
  vterm_state_set_unrecognised_fallbacks(observer->state, NULL, NULL);
  clear_history(observer);
  clear_notifications(observer);
  clear_cwd(observer);
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
const char *termless_vterm_screen_get_cwd(const TermlessObserver *observer) { return observer->cwd.value; }
int termless_vterm_screen_get_cwd_len(const TermlessObserver *observer) { return (int)observer->cwd.len; }
int termless_vterm_notification_count(const TermlessObserver *observer) { return observer->notifications[0].count; }
const char *termless_vterm_notification_get(const TermlessObserver *observer, int index) {
  const TermlessNotificationHistory *history = &observer->notifications[0];
  return index >= 0 && index < history->count ? history->entries[index].value : "";
}
int termless_vterm_notification_len(const TermlessObserver *observer, int index) {
  const TermlessNotificationHistory *history = &observer->notifications[0];
  return index >= 0 && index < history->count ? (int)history->entries[index].len : 0;
}
int termless_vterm_osc777_count(const TermlessObserver *observer) { return observer->notifications[1].count; }
int termless_vterm_unhandled_count(const TermlessObserver *observer) { return observer->unhandled_count; }
const char *termless_vterm_unhandled_kind(const TermlessObserver *observer, int index) {
  return index >= 0 && index < observer->unhandled_count ? observer->unhandled[index].kind : "";
}
const char *termless_vterm_unhandled_code(const TermlessObserver *observer, int index) {
  return index >= 0 && index < observer->unhandled_count ? observer->unhandled[index].code : "";
}
const char *termless_vterm_osc777_get(const TermlessObserver *observer, int index) {
  const TermlessNotificationHistory *history = &observer->notifications[1];
  return index >= 0 && index < history->count ? history->entries[index].value : "";
}
int termless_vterm_osc777_len(const TermlessObserver *observer, int index) {
  const TermlessNotificationHistory *history = &observer->notifications[1];
  return index >= 0 && index < history->count ? (int)history->entries[index].len : 0;
}
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
