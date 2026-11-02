#!/usr/bin/env python3
"""
Kitty VT parser bridge for termless.

Runs inside kitty's Python environment (kitty +runpy) and provides
a JSON-RPC interface over stdin/stdout. Each line of stdin is a JSON
command; each line of stdout is a JSON response.

Commands:
  init       {cols, rows, scrollbackLimit, cellWidth?, cellHeight?}  -> {ok: true}
  feed       {data: base64}                 -> {ok: true}
  resize     {cols, rows}                   -> {ok: true}
  reset      {}                             -> {ok: true}
  scroll     {delta}                        -> {ok: true}
  snapshot   {}                             -> snapshot (full terminal state)
  quit       {}                             -> {ok: true, quit: true}

A snapshot contains the full terminal state:
  {
    cells: [[{text, hyperlink, fg, bg, bold, dim, italic, underline, strikethrough, inverse, wide}, ...], ...],
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
import hashlib
import json
import platform
import sys
import sysconfig
import traceback
from collections import deque
from pathlib import Path

from kitty.clipboard import Clipboard, ClipboardRequestManager, ClipboardType
from kitty.fast_data_types import Screen, get_boss, get_options, set_boss, set_options
from kitty.notifications import DesktopIntegration, NotificationManager, PayloadType
from kitty.options.types import defaults

# The headless window's one non-default option: kitty's own clipboard_control values with the read permission a human
# would grant at kitty's default read-clipboard-ask / read-primary-ask prompt supplied up front, so an OSC 52 read
# answers through kitty's own request manager instead of waiting on a prompt nobody can answer. Reported in every
# snapshot's clipboard.control so a consumer records the supplied host input from the engine, not from this comment.
HEADLESS_CLIPBOARD_CONTROL = ("write-clipboard", "write-primary", "read-clipboard", "read-primary")
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
    """Decode kitty's internal color_type to [r, g, b] or None via the engine's live ColorProfile."""
    if val == 0:
        return None  # default color
    color = screen.color_profile.as_color(int(val) & 0xFFFFFFFF)
    if color is None:
        return None
    return [color.red, color.green, color.blue]


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


class HeadlessClipboard(Clipboard):
    """kitty's Clipboard with only the GLFW system clipboard replaced by this process's memory.

    Clipboard.set_mime keeps the data, then hands its types to GLFW (set_clipboard_data_types) and get_mime reads back
    through GLFW (get_clipboard_mime); neither exists headless. Everything above them, including clipboard_control
    permission and the OSC 52 encoding, stays kitty's own. Each commit is retained for getClipboardState.
    """

    def __init__(self, clipboard_type, selector):
        super().__init__(clipboard_type)
        self.selector = selector
        self.writes = []

    def set_mime(self, data):
        if self.enabled and isinstance(data, dict):
            self.data = dict(data)
            text = self._read("text/plain")
            if text is not None:
                self.writes.append({
                    "selector": self.selector,
                    "payload": base64.b64encode(text).decode("ascii"),
                    "text": text.decode("utf-8", "replace"),
                })

    def get_mime(self, mime, output):
        if self.enabled:
            data = self._read(mime)
            if data:
                output(data)

    def get_available_mime_types_for_paste(self):
        return tuple(self.data) if self.enabled else ()

    def _read(self, mime):
        value = self.data.get(mime)
        if value is None or isinstance(value, bytes):
            return value
        chunker = value()  # kitty DataType: a creator returning a chunk reader that ends with b""
        parts = []
        while chunk := chunker():
            parts.append(chunk)
        return b"".join(parts)


class HeadlessBoss:
    """Host context for reproduced Window callbacks, without desktop notification effects."""

    def __init__(self, window):
        self.window = window
        self.window_id_map = {window.id: window}
        self.active_window = window
        # Kitty's protocol base supplies its own capability response without starting a desktop/GLFW integration.
        integration = DesktopIntegration(None)
        self.notification_manager = NotificationManager(desktop_integration=integration)
        integration.notification_manager = self.notification_manager
        self.clipboard = HeadlessClipboard(ClipboardType.clipboard, "c")
        self.primary_selection = HeadlessClipboard(ClipboardType.primary_selection, "p")

    def default_bg_changed_for(self, window_id, via_escape_code=False):
        pass

    def confirm(self, *args, **kwargs):
        """kitty asks a human before a program reads the clipboard (default read-clipboard-ask). That consent is host
        input, not a callback this bridge failed to reproduce: record the prompt by name and answer nothing, so kitty's
        request stays pending exactly as it does while a human has not decided."""
        self._record_prompt("confirm")

    def choose(self, *args, **kwargs):
        """The OSC 5522 password permission prompt (Allow/Always/Deny/Ban); recorded like confirm, never answered."""
        self._record_prompt("choose")

    def _record_prompt(self, name):
        prompt = {"name": name}
        pending = self.window.clipboard_request_manager.currently_asking_permission_for
        if pending is not None and pending.human_name:
            prompt["humanName"] = pending.human_name
        self.window.prompts.append(prompt)

    def clipboard_writes(self):
        return self.clipboard.writes + self.primary_selection.writes


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
    # OSC 52 and OSC 5522: kitty's own request manager under its default clipboard_control option.
    clipboard_control = Window.clipboard_control
    destroyed = False

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
        self.prompts = []  # Permission prompts kitty raised for a human; host input, never answered
        self.cmd_output_markings = []  # Exact positional native callback arguments, in observation order
        self.clipboard_request_manager = ClipboardRequestManager(self.id)  # as kitty's Window.__init__ does

    def write(self, data):
        raw = bytes(data)
        self.wtcbuf += raw
        self.responses += raw

    def no_reply(self, *args, **kwargs):
        """A Window callback that changes host or title state only and never writes to the child."""

    icon_changed = osc_context = on_reset = on_bell = no_reply
    color_profile_popped = on_activity_since_last_focus = send_signal_for_key = no_reply

    def cmd_output_marking(self, *args):
        self.cmd_output_markings.append(list(args))

    def desktop_notify(self, osc_code, raw_data):
        # OSC 1337 only sets user variables (Window.osc_1337), and OSC 9 and 777 only show a notification;
        # OSC 99 can answer through the boss's notification manager, which is host state.
        if osc_code == 99:
            manager = get_boss().notification_manager
            command = manager.create_notification_cmd()
            metadata = str(raw_data, "utf-8", "replace").partition(";")[0]
            payload_type, _ = command.parse_metadata(metadata, command)
            if payload_type is PayloadType.query:
                # Reproduce only capability detection, using kitty's Window/manager and original reply encoding.
                Window.desktop_notify(self, osc_code, raw_data)
                return
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

    def drain_prompts(self):
        prompts = self.prompts
        self.prompts = []
        return prompts

    def drain_cmd_output_markings(self):
        markings = self.cmd_output_markings
        self.cmd_output_markings = []
        return markings

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


class NativeModeStateUnavailable(RuntimeError):
    pass


def read_native_modes(native_screen):
    """Read only the two header-derived fields of the independently attested Screen layout."""
    layout_path = Path(__file__).with_name("native-mode-layout.json")
    receipt_path = Path(__file__).with_name("native-mode-layout.receipt.json")

    def match(field, observed, expected):
        if type(observed) is not type(expected) or observed != expected:
            raise ValueError(f"{field}: expected {expected!r}; observed {observed!r}")

    try:
        import ctypes
        import kitty.fast_data_types as native
        from kitty.constants import version

        raw_layout = layout_path.read_bytes()
        receipt = json.loads(receipt_path.read_bytes())
        match("manifest sha256", hashlib.sha256(raw_layout).hexdigest(), receipt["sha256"])
        layout = json.loads(raw_layout)
        match("manifest schemaVersion", layout["schemaVersion"], 1)
        match("Kitty version", ".".join(map(str, version)), layout["kittyVersion"])
        match("Kitty source revision", native.KITTY_VCS_REV, layout["sourceCommit"])
        module_path = Path(native.__file__)
        match("native module sha256", hashlib.sha256(module_path.read_bytes()).hexdigest(), layout["nativeModuleSha256"])
        if type(native_screen) is not native.Screen:
            raise ValueError(f"Screen type identity: expected {native.Screen!r}; observed {type(native_screen)!r}")

        target = layout["platform"]
        for field, observed in (("system", platform.system()), ("machine", platform.machine()),
                                ("byteOrder", sys.byteorder), ("pointerSize", ctypes.sizeof(ctypes.c_void_p))):
            match(f"platform.{field}", observed, target[field])
        python = layout["python"]
        for field, observed in (("implementation", platform.python_implementation()),
                                ("major", sys.version_info.major), ("minor", sys.version_info.minor)):
            match(f"python.{field}", observed, python[field])
        for field, key in (("pyDebug", "Py_DEBUG"), ("pyTraceRefs", "Py_TRACE_REFS"),
                           ("pyGilDisabled", "Py_GIL_DISABLED")):
            match(f"python.{field} manifest", python[field], 0)
            match(f"python.{field}", sysconfig.get_config_var(key), python[field])

        screen_layout = layout["screen"]
        match("Screen basicsize", type(native_screen).__basicsize__, screen_layout["size"])
        match("Screen itemsize", type(native_screen).__itemsize__, 0)
        readers = (("reverseVideo", ctypes.c_bool, "bool"), ("syncOutput", ctypes.c_int64, "int64_t"))
        for name, scalar, c_type in readers:
            field = screen_layout[name]
            match(f"{name}.cType", field["cType"], c_type)
            match(f"{name}.width", field["width"], ctypes.sizeof(scalar))
            offset = field["offset"]
            if type(offset) is not int or offset < 0 or offset + field["width"] > screen_layout["size"]:
                raise ValueError(f"{name}.offset: {offset!r} is outside Screen size {screen_layout['size']}")
            if offset % ctypes.alignment(scalar):
                raise ValueError(f"{name}.offset: {offset} is not aligned for {c_type}")

        # L1: the build receipt proves header offsets/widths agree with the pinned native ELF,
        # and header sizeof(Screen) agrees with the runtime. Revalidate L2 above on every snapshot.
        # Keep native_screen strongly referenced under the normal GIL; ctypes scalar reads do not release it.
        address = id(native_screen)
        return {
            "reverseVideo": ctypes.c_bool.from_address(address + screen_layout["reverseVideo"]["offset"]).value,
            "syncOutput": ctypes.c_int64.from_address(address + screen_layout["syncOutput"]["offset"]).value != 0,
        }
    except (OSError, ValueError, KeyError, TypeError, ImportError, AttributeError) as error:
        raise NativeModeStateUnavailable(
            f"KITTY_NATIVE_STATE_UNAVAILABLE: Kitty native modes at {layout_path} (receipt {receipt_path}): {error}"
        ) from error


def make_snapshot():
    """Create a full terminal state snapshot."""
    global screen, callbacks, cols, rows

    if screen is None:
        return {"error": "not initialized"}

    # All readers use chronological rows in the selected buffer, independent of viewport scrolling.
    alternate = screen.is_using_alternate_linebuf()
    hist = screen.historybuf
    history_rows = 0 if alternate else hist.count
    cell_rows = []
    text_lines = []
    for row in range(history_rows + rows):
        screen_row = row - history_rows
        # HistoryBuf.line returns a borrowed Line: serialize it before requesting another history row.
        line = hist.line(history_rows - 1 - row) if screen_row < 0 else screen.line(screen_row)
        cpu = screen.cpu_cells(screen_row)
        cell_row = []
        for col in range(cols):
            cell_data = cpu[col]
            cur = line.cursor_from(col)

            text = cell_data["text"]
            if not text or text == "\0":
                text = ""

            # cpu_cells carries Kitty's stored id:URI. Match get_hyperlink_for_id(..., only_url=True): strip only the
            # first colon, retaining every URI colon and an empty URI. Missing or malformed expected metadata is fatal.
            hyperlink = cell_data["hyperlink"]
            if hyperlink is not None:
                if not isinstance(hyperlink, str):
                    raise TypeError("Kitty CPU-cell hyperlink must be a string or None")
                if ":" not in hyperlink:
                    raise ValueError("Kitty CPU-cell hyperlink is missing its id:URI separator")
                hyperlink = hyperlink.split(":", 1)[1]

            cell_row.append({
                "text": text,
                "hyperlink": hyperlink,
                "fg": decode_color(cur.fg),
                "bg": decode_color(cur.bg),
                "bold": cur.bold,
                "dim": cur.dim,
                "italic": cur.italic,
                "underline": decode_underline(cur.decoration),
                "underlineColor": decode_color(cur.decoration_fg),
                "strikethrough": cur.strikethrough,
                "inverse": cur.reverse,
                "blink": cur.text_blink if hasattr(cur, "text_blink") else False,
                "wide": _safe_width(line, col),
            })
        cell_rows.append(cell_row)
        text_lines.append("".join(
            cell["text"] or ("" if col > 0 and cell_row[col - 1]["wide"] else " ")
            for col, cell in enumerate(cell_row)
        ).rstrip())

    # Cursor
    cursor = {
        "x": screen.cursor.x,
        "y": screen.cursor.y,
        "visible": screen.cursor_visible,
        "style": decode_cursor_shape(screen.cursor.shape),
    }

    # Title
    title = callbacks.title if callbacks else ""

    # Existing exposed properties plus the two independently attested native fields.
    modes = {
        "altScreen": alternate,
        "bracketedPaste": screen.in_bracketed_paste_mode,
        "applicationCursor": screen.cursor_key_mode,
        "cursorVisible": screen.cursor_visible,
        "focusTracking": screen.focus_tracking_enabled,
        "colorSchemeReporting": screen.color_preference_notification,
    }
    native_mode_error = None
    try:
        modes.update(read_native_modes(screen))
    except NativeModeStateUnavailable as error:
        # Preserve generic snapshots; the two requesting getMode calls surface this exact diagnostic.
        native_mode_error = str(error)

    # Scrollback
    scrollback = {
        "viewportOffset": screen.scrolled_by,
        "totalLines": history_rows + rows,
        "screenLines": rows,
    }

    # Full text
    text = "\n".join(text_lines)

    # Drain any accumulated response data (DA1/DA2/DSR responses)
    response_data = callbacks.drain_responses() if callbacks else b""
    unreproduced = callbacks.drain_unreproduced() if callbacks else []
    prompts = callbacks.drain_prompts() if callbacks else []
    cmd_output_markings = callbacks.drain_cmd_output_markings() if callbacks else []

    result = {
        "cells": cell_rows,
        "cursor": cursor,
        "title": title,
        "modes": modes,
        "scrollback": scrollback,
        "text": text,
    }
    if native_mode_error is not None:
        result["nativeModeError"] = native_mode_error
    if response_data:
        result["responses"] = base64.b64encode(response_data).decode("ascii")
    if unreproduced:
        result["unreproduced"] = unreproduced
    if prompts:
        result["prompts"] = prompts
    if cmd_output_markings:
        result["cmdOutputMarkings"] = cmd_output_markings
    boss = get_boss()
    if boss is None:
        raise RuntimeError("kitty bridge snapshot has no boss; clipboard state is unknown, never empty")
    result["clipboard"] = {
        "writes": boss.clipboard_writes(),
        "control": list(get_options().clipboard_control),
    }
    return result


def handle_command(cmd):
    """Process a single command and return a response."""
    global screen, callbacks, cols, rows

    op = cmd.get("op")

    if op == "init":
        cols = cmd.get("cols", 80)
        rows = cmd.get("rows", 24)
        scrollback_limit = cmd.get("scrollbackLimit", 1000)

        set_options(defaults._replace(clipboard_control=HEADLESS_CLIPBOARD_CONTROL))
        callbacks = Callbacks()
        set_boss(HeadlessBoss(callbacks))
        # Screen(callbacks, lines, cols, scrollback, cell_width, cell_height, window_id, test_child)
        # Kitty answers CSI 14t/16t from this cell size and keeps it across resize. It is the caller's declared
        # pixel geometry; none declared keeps 0x0, so headless Screen never invents pixel metrics.
        cell_width = cmd.get("cellWidth", 0)
        cell_height = cmd.get("cellHeight", 0)
        screen = Screen(callbacks, rows, cols, scrollback_limit, cell_width, cell_height, 0, callbacks)
        callbacks.screen = screen
        return {"ok": True}

    elif op == "feed":
        data = base64.b64decode(cmd["data"])
        # Clear response buffer before feeding so we capture only this feed's responses
        if callbacks:
            callbacks.drain_responses()
            callbacks.drain_unreproduced()
            callbacks.drain_prompts()
            callbacks.drain_cmd_output_markings()
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
            prompts = callbacks.drain_prompts()
            if prompts:
                result["prompts"] = prompts
            cmd_output_markings = callbacks.drain_cmd_output_markings()
            if cmd_output_markings:
                result["cmdOutputMarkings"] = cmd_output_markings
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
        all_prompts = []  # Likewise prefix-compared
        all_cmd_output_markings = []  # Native observations; retain duplicate-valued callbacks and reset history
        for cmd in commands:
            result = handle_command(cmd)
            if result.get("error"):
                sys.stdout.write(json.dumps(result) + "\n")
                return
            # Collect per-feed response data
            if "responses" in result:
                all_responses += base64.b64decode(result["responses"])
            all_unreproduced.extend(result.get("unreproduced", ()))
            all_prompts.extend(result.get("prompts", ()))
            all_cmd_output_markings.extend(result.get("cmdOutputMarkings", ()))

        # Return the final snapshot with accumulated responses
        snapshot = make_snapshot()
        all_cmd_output_markings.extend(snapshot.get("cmdOutputMarkings", ()))
        if all_cmd_output_markings:
            snapshot["cmdOutputMarkings"] = all_cmd_output_markings
        if all_responses:
            snapshot["responses"] = base64.b64encode(all_responses).decode("ascii")
        if all_unreproduced:
            snapshot["unreproduced"] = all_unreproduced
        if all_prompts:
            snapshot["prompts"] = all_prompts
        sys.stdout.write(json.dumps(snapshot) + "\n")
    except Exception as e:
        sys.stdout.write(json.dumps({
            "error": str(e),
            "traceback": traceback.format_exc(),
        }) + "\n")


if __name__ == "__main__":
    main()
