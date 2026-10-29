#!/usr/bin/env python3
"""
Kitty VT parser bridge for termless.

Runs inside kitty's Python environment (kitty +runpy) and provides
a JSON-RPC interface over stdin/stdout. Each line of stdin is a JSON
command; each line of stdout is a JSON response.

Commands:
  init       {cols, rows, scrollbackLimit}  -> {ok: true}
  feed       {data: base64}                 -> {ok: true}
  resize     {cols, rows}                   -> {ok: true}
  reset      {}                             -> {ok: true}
  scroll     {delta}                        -> {ok: true}
  snapshot   {}                             -> snapshot (full terminal state)
  quit       {}                             -> {ok: true, quit: true}

A snapshot contains the full terminal state:
  {
    cells: [[{text, fg, bg, bold, dim, italic, underline, strikethrough, inverse, wide}, ...], ...],
    cursor: {x, y, visible, style},
    title: string,
    modes: {altScreen, bracketedPaste, applicationCursor, autoWrap, ...},
    scrollback: {viewportOffset, totalLines, screenLines},
    text: string
  }

Color format:
  null = default color
  [r, g, b] = RGB truecolor or resolved indexed color
"""

import base64
import json
import sys
import traceback
from collections import deque

from kitty.fast_data_types import Screen, set_boss, set_options
from kitty.options.types import defaults
from kitty.window import Window

# kitty's C Screen prints an exception raised inside a Window callback through sys.excepthook and replays on, so a reply
# the callback never sent would read as the engine's silence. Record each one; the feed that raised it fails loud.
callback_errors = []
sys.excepthook = lambda kind, value, tb: callback_errors.append("".join(traceback.format_exception(kind, value, tb)))

# Standard 16-color ANSI palette (xterm defaults)
ANSI_16 = [
    (0x00, 0x00, 0x00),  # 0  Black
    (0x80, 0x00, 0x00),  # 1  Red
    (0x00, 0x80, 0x00),  # 2  Green
    (0x80, 0x80, 0x00),  # 3  Yellow
    (0x00, 0x00, 0x80),  # 4  Blue
    (0x80, 0x00, 0x80),  # 5  Magenta
    (0x00, 0x80, 0x80),  # 6  Cyan
    (0xC0, 0xC0, 0xC0),  # 7  White
    (0x80, 0x80, 0x80),  # 8  Bright Black
    (0xFF, 0x00, 0x00),  # 9  Bright Red
    (0x00, 0xFF, 0x00),  # 10 Bright Green
    (0xFF, 0xFF, 0x00),  # 11 Bright Yellow
    (0x00, 0x00, 0xFF),  # 12 Bright Blue
    (0xFF, 0x00, 0xFF),  # 13 Bright Magenta
    (0x00, 0xFF, 0xFF),  # 14 Bright Cyan
    (0xFF, 0xFF, 0xFF),  # 15 Bright White
]


def palette_256(index):
    """Resolve a 256-color index to RGB."""
    if index < 16:
        return ANSI_16[index]
    if index < 232:
        idx = index - 16
        levels = [0x00, 0x5F, 0x87, 0xAF, 0xD7, 0xFF]
        r = levels[idx // 36]
        g = levels[(idx // 6) % 6]
        b = levels[idx % 6]
        return (r, g, b)
    # Grayscale ramp 232-255
    v = 8 + (index - 232) * 10
    return (v, v, v)


def decode_color(val):
    """Decode kitty's internal color_type to [r, g, b] or None."""
    if val == 0:
        return None  # default color
    flags = val & 0xFF
    if flags & 2:
        # Truecolor: (R << 24) | (G << 16) | (B << 8) | 0x02
        r = (val >> 24) & 0xFF
        g = (val >> 16) & 0xFF
        b = (val >> 8) & 0xFF
        return [r, g, b]
    elif flags & 1:
        # Indexed: (index << 8) | 0x01
        index = (val >> 8) & 0xFF
        rgb = palette_256(index)
        return list(rgb)
    return None


def decode_underline(decoration):
    """Convert kitty decoration value to underline style string."""
    # From kitty's cursor.h: 0=none, 1=single, 2=double, 3=curly, 4=dotted, 5=dashed
    return {
        0: "none", 1: "single", 2: "double", 3: "curly",
        4: "dotted", 5: "dashed",
    }.get(decoration, "none")


def decode_cursor_shape(shape):
    """Convert kitty cursor shape to style string."""
    # From data-types.h: CURSOR_BLOCK=1, CURSOR_BEAM=2, CURSOR_UNDERLINE=3
    return {0: "block", 1: "block", 2: "beam", 3: "underline"}.get(shape, "block")


class HeadlessBoss:
    """The one boss method a reproduced Window callback reaches; in kitty it only redraws host windows."""

    def default_bg_changed_for(self, window_id, via_escape_code=False):
        pass


class Callbacks:
    """The headless Screen's window.

    Every Screen -> Window callback that can write to the child runs kitty's own Window method
    unchanged; any callback without a method here is recorded in `unreproduced`, never answered.
    """

    # Reply-bearing Window methods, reproduced unchanged; they read self.screen, self.id and self.os_window_id.
    on_da1 = Window.on_da1
    report_color = Window.report_color
    set_dynamic_color = Window.set_dynamic_color
    set_color_table_color = Window.set_color_table_color
    request_capabilities = Window.request_capabilities
    color_control = Window.color_control
    report_color_scheme_preference = Window.report_color_scheme_preference
    is_dark = Window.is_dark

    def refresh(self, reload_all_gpu_data=False):
        """kitty's Window.refresh marks the screen dirty, then wakes the host I/O and main loops to redraw; it writes no
        child bytes. The headless replay has neither loop (waking the main loop without one segfaults), so only the mark."""
        self.screen.mark_as_dirty()

    def __init__(self):
        self.screen = None
        self.id = 0  # The Screen is created with window_id 0.
        self.os_window_id = 0
        self.wtcbuf = b""
        self.title = ""
        self.title_stack = deque(maxlen=10)
        self.responses = b""  # Accumulated DA1/DA2/DSR response data
        self.unreproduced = []  # Callback names this feed reached that the bridge does not reproduce

    def write(self, data):
        raw = bytes(data)
        self.wtcbuf += raw
        self.responses += raw

    def no_reply(self, *args, **kwargs):
        """A Window callback that changes host or title state only and never writes to the child."""

    icon_changed = osc_context = on_reset = on_bell = cmd_output_marking = no_reply
    color_profile_popped = on_activity_since_last_focus = send_signal_for_key = no_reply

    def desktop_notify(self, osc_code, raw_data):
        # OSC 1337 only sets user variables (Window.osc_1337), and OSC 9 and 777 only show a notification;
        # OSC 99 can answer through the boss's notification manager, which is host state.
        if osc_code == 99:
            self.unreproduced.append("desktop_notify")

    def title_changed(self, title, raw=None):
        if hasattr(title, "tobytes"):
            self.title = bytes(title).decode("utf-8", errors="replace")
        else:
            self.title = str(title)

    def manipulate_title_stack(self, pop, title, icon):
        # Kitty's Window owns the title stack; its icon stack is not implemented.
        if not title:
            return
        if pop:
            if self.title_stack:
                self.title = self.title_stack.pop()
        elif self.title:
            self.title_stack.append(self.title)

    def drain_responses(self):
        """Drain and return accumulated response data."""
        data = self.responses
        self.responses = b""
        return data

    def drain_unreproduced(self):
        names = sorted(set(self.unreproduced))
        self.unreproduced = []
        return names

    def __getattr__(self, name):
        """Record any other callback kitty invokes (clipboard, file transfer, resize report, remote control)."""
        if name.startswith("__"):
            raise AttributeError(name)
        return lambda *a, **kw: self.unreproduced.append(name)


# Global state
screen = None
callbacks = None
cols = 80
rows = 24


def parse_bytes(s, data):
    """Feed bytes to the screen's VT parser (same as kitty_tests.parse_bytes)."""
    data = memoryview(data)
    while data:
        dest = s.test_create_write_buffer()
        n = s.test_commit_write_buffer(data, dest)
        data = data[n:]
        s.test_parse_written_data()


def _safe_width(line, col):
    """Check if a cell is wide, handling kitty API quirks."""
    try:
        return line.width(col) == 2
    except (SystemError, ValueError):
        return False


def make_snapshot():
    """Create a full terminal state snapshot."""
    global screen, callbacks, cols, rows

    if screen is None:
        return {"error": "not initialized"}

    # Cells
    cell_rows = []
    for row in range(rows):
        line = screen.line(row)
        cpu = screen.cpu_cells(row)
        cell_row = []
        for col in range(cols):
            cell_data = cpu[col]
            cur = line.cursor_from(col)

            text = cell_data["text"]
            if not text or text == "\0":
                text = ""

            cell_row.append({
                "text": text,
                "fg": decode_color(cur.fg),
                "bg": decode_color(cur.bg),
                "bold": cur.bold,
                "dim": cur.dim,
                "italic": cur.italic,
                "underline": decode_underline(cur.decoration),
                "strikethrough": cur.strikethrough,
                "inverse": cur.reverse,
                "blink": cur.text_blink if hasattr(cur, "text_blink") else False,
                "wide": _safe_width(line, col),
            })
        cell_rows.append(cell_row)

    # Cursor
    cursor = {
        "x": screen.cursor.x,
        "y": screen.cursor.y,
        "visible": screen.cursor_visible,
        "style": decode_cursor_shape(screen.cursor.shape),
    }

    # Title
    title = callbacks.title if callbacks else ""

    # Modes (only expose modes backed by Kitty Python Screen properties;
    # modes without a Python Screen getter stay absent so getMode returns null)
    modes = {
        "altScreen": screen.is_using_alternate_linebuf(),
        "bracketedPaste": screen.in_bracketed_paste_mode,
        "applicationCursor": screen.cursor_key_mode,
        "cursorVisible": screen.cursor_visible,
        "focusTracking": screen.focus_tracking_enabled,
    }

    # Scrollback
    hist = screen.historybuf
    scrollback = {
        "viewportOffset": screen.scrolled_by,
        "totalLines": hist.count + rows,
        "screenLines": rows,
    }

    # Full text
    lines = []
    for row in range(rows):
        lines.append(screen.line(row).as_ansi())
    # Strip ANSI escapes for plain text
    import re
    ansi_escape = re.compile(r"\033\[[0-9;]*m")
    text = "\n".join(ansi_escape.sub("", l) for l in lines)

    # Drain any accumulated response data (DA1/DA2/DSR responses)
    response_data = callbacks.drain_responses() if callbacks else b""
    unreproduced = callbacks.drain_unreproduced() if callbacks else []

    result = {
        "cells": cell_rows,
        "cursor": cursor,
        "title": title,
        "modes": modes,
        "scrollback": scrollback,
        "text": text,
    }
    if response_data:
        result["responses"] = base64.b64encode(response_data).decode("ascii")
    if unreproduced:
        result["unreproduced"] = unreproduced
    return result


def handle_command(cmd):
    """Process a single command and return a response."""
    global screen, callbacks, cols, rows

    op = cmd.get("op")

    if op == "init":
        cols = cmd.get("cols", 80)
        rows = cmd.get("rows", 24)
        scrollback_limit = cmd.get("scrollbackLimit", 1000)

        set_options(defaults)
        set_boss(HeadlessBoss())
        callbacks = Callbacks()
        # Screen(callbacks, lines, cols, scrollback, cell_width, cell_height, window_id, test_child)
        # Pass 0x0 cell dimensions so headless Screen does not invent pixel metrics for CSI 14t/16t.
        screen = Screen(callbacks, rows, cols, scrollback_limit, 0, 0, 0, callbacks)
        callbacks.screen = screen
        return {"ok": True}

    elif op == "feed":
        data = base64.b64decode(cmd["data"])
        # Clear response buffer before feeding so we capture only this feed's responses
        if callbacks:
            callbacks.drain_responses()
            callbacks.drain_unreproduced()
        parse_bytes(screen, data)
        if callback_errors:
            raised = "".join(callback_errors)
            callback_errors.clear()
            return {"error": "kitty Window callback raised during feed", "traceback": raised}
        result = {"ok": True}
        # Include any response data generated by this feed (DA1/DA2/DSR)
        if callbacks:
            resp = callbacks.drain_responses()
            if resp:
                result["responses"] = base64.b64encode(resp).decode("ascii")
            unreproduced = callbacks.drain_unreproduced()
            if unreproduced:
                result["unreproduced"] = unreproduced
        return result

    elif op == "resize":
        cols = cmd["cols"]
        rows = cmd["rows"]
        screen.resize(rows, cols)
        return {"ok": True}

    elif op == "reset":
        screen.reset()
        return {"ok": True}

    elif op == "scroll":
        delta = cmd["delta"]
        # delta > 0 = towards recent (down), delta < 0 = towards older (up)
        # screen.scroll(count, upward): upward=True shows older lines
        screen.scroll(abs(delta), delta < 0)
        return {"ok": True}

    elif op == "snapshot":
        return make_snapshot()

    elif op == "quit":
        return {"ok": True, "quit": True}

    else:
        return {"error": f"unknown command: {op}"}


def main():
    """Main loop: read JSON commands from stdin, write JSON responses to stdout."""
    # Signal readiness
    sys.stdout.write('{"ready":true}\n')
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
            result = handle_command(cmd)
        except Exception as e:
            result = {"error": str(e), "traceback": traceback.format_exc()}

        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()

        if result.get("quit"):
            break


def batch_main():
    """Batch mode: read all commands from stdin as JSON, replay them, return snapshot.

    Input format (JSON on stdin):
      { "commands": [ {op: "init", ...}, {op: "feed", ...}, ... ] }

    Output (JSON on stdout):
      The result of a snapshot after all commands have been replayed.
      If any command fails, returns the error immediately.
    """
    try:
        raw = sys.stdin.read()
        batch = json.loads(raw)
        commands = batch.get("commands", [])

        # Accumulate response data from all feed commands
        all_responses = b""
        all_unreproduced = []  # In feed order, so a later replay can be prefix-compared like responses
        for cmd in commands:
            result = handle_command(cmd)
            if result.get("error"):
                sys.stdout.write(json.dumps(result) + "\n")
                return
            # Collect per-feed response data
            if "responses" in result:
                all_responses += base64.b64decode(result["responses"])
            all_unreproduced.extend(result.get("unreproduced", ()))

        # Return the final snapshot with accumulated responses
        snapshot = make_snapshot()
        if all_responses:
            snapshot["responses"] = base64.b64encode(all_responses).decode("ascii")
        if all_unreproduced:
            snapshot["unreproduced"] = all_unreproduced
        sys.stdout.write(json.dumps(snapshot) + "\n")
    except Exception as e:
        sys.stdout.write(json.dumps({
            "error": str(e),
            "traceback": traceback.format_exc(),
        }) + "\n")


if __name__ == "__main__":
    main()
