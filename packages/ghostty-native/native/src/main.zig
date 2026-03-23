/// N-API bindings for Ghostty's terminal emulation core.
///
/// Uses Ghostty's Zig API directly (not the C headers) for full access to
/// the terminal state machine, screen buffer, cell styles, and scrollback.
/// Exposes a headless terminal to Node.js/Bun via napigen.
const std = @import("std");
const napigen = @import("napigen");
const ghostty = @import("ghostty");

// ghostty's lib_vt.zig public API — types are exported directly,
// not under a `terminal` namespace.
const Terminal = ghostty.Terminal;
const Screen = ghostty.Screen;
const PageList = ghostty.PageList;
const Cell = ghostty.Cell;
const Page = ghostty.Page;
const Style = ghostty.Style;
const ReadonlyStream = ghostty.ReadonlyStream;
const color = ghostty.color;
const modes = ghostty.modes;
const point = ghostty.point;
const size = ghostty.size;

// ─── Allocator ──────────────────────────────────────────

var gpa = std.heap.GeneralPurposeAllocator(.{}){};
const allocator = gpa.allocator();

// ─── Terminal handle ────────────────────────────────────

/// Wraps a Ghostty Terminal + VT stream for the JS side.
/// The stream handles parsing of escape sequences and feeding
/// them into the terminal state machine.
const TerminalHandle = struct {
    terminal: Terminal,
    stream: ReadonlyStream,
    cols: size.CellCountInt,
    rows: size.CellCountInt,
    title: []const u8,
};

// ─── Module init ────────────────────────────────────────

comptime {
    napigen.defineModule(initModule);
}

fn initModule(js: *napigen.JsContext, exports: napigen.napi_value) napigen.Error!napigen.napi_value {
    try js.setNamedProperty(exports, "createTerminal", try js.createFunction(createTerminal));
    try js.setNamedProperty(exports, "destroyTerminal", try js.createFunction(destroyTerminal));
    try js.setNamedProperty(exports, "feed", try js.createFunction(feed));
    try js.setNamedProperty(exports, "resize", try js.createFunction(resizeTerm));
    try js.setNamedProperty(exports, "reset", try js.createFunction(resetTerm));
    try js.setNamedProperty(exports, "getText", try js.createFunction(getText));
    try js.setNamedProperty(exports, "getTextRange", try js.createFunction(getTextRange));
    try js.setNamedProperty(exports, "getCell", try js.createFunction(getCell));
    try js.setNamedProperty(exports, "getLine", try js.createFunction(getLine));
    try js.setNamedProperty(exports, "getLines", try js.createFunction(getLines));
    try js.setNamedProperty(exports, "getCursor", try js.createFunction(getCursor));
    try js.setNamedProperty(exports, "getMode", try js.createFunction(getMode));
    try js.setNamedProperty(exports, "getTitle", try js.createFunction(getTitle));
    try js.setNamedProperty(exports, "getScrollback", try js.createFunction(getScrollback));
    try js.setNamedProperty(exports, "scrollViewport", try js.createFunction(scrollViewport));
    try js.setNamedProperty(exports, "getDefaultColors", try js.createFunction(getDefaultColors));
    return exports;
}

// ─── Terminal lifecycle ─────────────────────────────────

fn createTerminal(cols: u16, rows: u16, max_scrollback: u32) !*TerminalHandle {
    const handle = allocator.create(TerminalHandle) catch return error.OutOfMemory;
    errdefer allocator.destroy(handle);

    handle.terminal = Terminal.init(allocator, .{
        .cols = cols,
        .rows = rows,
        .max_scrollback = @as(usize, max_scrollback),
    }) catch return error.TerminalCreationFailed;
    errdefer handle.terminal.deinit(allocator);

    handle.stream = handle.terminal.vtStream();
    handle.cols = cols;
    handle.rows = rows;
    handle.title = "";

    return handle;
}

fn destroyTerminal(handle: *TerminalHandle) void {
    handle.stream.deinit();
    handle.terminal.deinit(allocator);
    if (handle.title.len > 0) {
        allocator.free(handle.title);
    }
    allocator.destroy(handle);
}

// ─── Feed / resize / reset ──────────────────────────────

fn feed(js: *napigen.JsContext, handle: *TerminalHandle, data_val: napigen.napi_value) void {
    // Accept both strings and Uint8Array/Buffer from JS.
    // Terminal data is raw bytes (escape sequences + UTF-8 text).
    const napi = napigen.napi;
    const env = js.env;

    // Try to get data as a Node.js Buffer first
    var data_ptr: ?[*]u8 = null;
    var data_len: usize = 0;
    if (napi.napi_get_buffer_info(env, data_val, @ptrCast(&data_ptr), &data_len) == napi.napi_ok) {
        if (data_ptr) |ptr| {
            handle.stream.nextSlice(ptr[0..data_len]) catch {};
            return;
        }
    }

    // Try as a typed array (Uint8Array)
    var typed_type: napi.napi_typedarray_type = undefined;
    var typed_len: usize = 0;
    var typed_data: ?*anyopaque = null;
    var typed_buf: napi.napi_value = undefined;
    var typed_offset: usize = 0;
    if (napi.napi_get_typedarray_info(env, data_val, &typed_type, &typed_len, &typed_data, &typed_buf, &typed_offset) == napi.napi_ok) {
        if (typed_data) |ptr| {
            const bytes: [*]u8 = @ptrCast(ptr);
            handle.stream.nextSlice(bytes[0..typed_len]) catch {};
            return;
        }
    }

    // Fall back to string
    const str = js.readString(data_val) catch return;
    handle.stream.nextSlice(str) catch {};
}

fn resizeTerm(handle: *TerminalHandle, cols: u16, rows: u16) void {
    handle.terminal.resize(allocator, cols, rows) catch {};
    handle.cols = cols;
    handle.rows = rows;
}

fn resetTerm(handle: *TerminalHandle) void {
    handle.terminal.fullReset();
}

// ─── Text extraction ────────────────────────────────────

fn getText(handle: *TerminalHandle) ![]const u8 {
    const str = handle.terminal.plainString(allocator) catch return error.OutOfMemory;
    return str;
}

fn getTextRange(handle: *TerminalHandle, start_row: u16, start_col: u16, end_row: u16, end_col: u16) ![]const u8 {
    // Zig 0.15: ArrayList is unmanaged, allocator passed to each call
    var result_buf: std.ArrayList(u8) = .empty;
    defer result_buf.deinit(allocator);

    const screen = handle.terminal.screens.active;
    const pages = &screen.pages;

    var row: u16 = start_row;
    while (row <= end_row) : (row += 1) {
        if (row > start_row) {
            try result_buf.append(allocator, '\n');
        }

        const col_start: u16 = if (row == start_row) start_col else 0;
        const col_end: u16 = if (row == end_row) end_col else handle.cols;

        var col: u16 = col_start;
        while (col < col_end) : (col += 1) {
            const p = pages.pin(.{ .viewport = .{ .x = col, .y = row } }) orelse continue;
            const rac = p.rowAndCell();
            const cell = rac.cell;

            try appendCellTextFromCell(&result_buf, cell, p.node.data);
        }
    }

    const out = try allocator.alloc(u8, result_buf.items.len);
    @memcpy(out, result_buf.items);
    return out;
}

fn appendCellTextFromCell(buf: *std.ArrayList(u8), cell: *const Cell, page: Page) !void {
    const cp = cell.codepoint();
    if (cp == 0) {
        try buf.append(allocator, ' ');
        return;
    }

    // Encode the base codepoint
    var utf8_buf: [4]u8 = undefined;
    const utf8_len = std.unicode.utf8Encode(cp, &utf8_buf) catch {
        try buf.append(allocator, '?');
        return;
    };
    try buf.appendSlice(allocator, utf8_buf[0..utf8_len]);

    // If this cell has grapheme cluster data, append the extra codepoints
    if (cell.hasGrapheme()) {
        if (page.lookupGrapheme(cell)) |extra_cps| {
            for (extra_cps) |extra_cp| {
                const extra_len = std.unicode.utf8Encode(extra_cp, &utf8_buf) catch continue;
                try buf.appendSlice(allocator, utf8_buf[0..extra_len]);
            }
        }
    }
}

// ─── Cell reading ───────────────────────────────────────

/// Cell data returned to JS as a plain object.
const JsCell = struct {
    text: []const u8,
    fg_r: i16, // -1 = default
    fg_g: i16,
    fg_b: i16,
    bg_r: i16,
    bg_g: i16,
    bg_b: i16,
    bold: bool,
    faint: bool,
    italic: bool,
    underline: i8, // 0=none, 1=single, 2=double, 3=curly, 4=dotted, 5=dashed
    strikethrough: bool,
    inverse: bool,
    wide: u8, // 0=narrow, 1=wide, 2=spacer_tail
};

fn readCellAt(handle: *TerminalHandle, row: u16, col: u16) JsCell {
    const screen = handle.terminal.screens.active;
    const pages = &screen.pages;

    // Get the pin for this viewport position
    const p = pages.pin(.{ .viewport = .{ .x = col, .y = row } }) orelse return defaultCell();
    const rac = p.rowAndCell();
    const cell = rac.cell;
    const page = &p.node.data;

    // Extract text (codepoint + grapheme cluster)
    var text_buf: [64]u8 = undefined;
    var text_pos: usize = 0;

    const cp = cell.codepoint();
    if (cp != 0) {
        const utf8_len = std.unicode.utf8Encode(cp, text_buf[0..4]) catch 0;
        text_pos = utf8_len;

        // Append grapheme cluster extra codepoints
        if (cell.hasGrapheme()) {
            if (page.lookupGrapheme(cell)) |extra_cps| {
                for (extra_cps) |extra_cp| {
                    if (text_pos + 4 > text_buf.len) break;
                    const extra_len = std.unicode.utf8Encode(extra_cp, text_buf[text_pos..][0..4]) catch continue;
                    text_pos += extra_len;
                }
            }
        }
    }

    // Extract style
    var fg_r: i16 = -1;
    var fg_g: i16 = -1;
    var fg_b: i16 = -1;
    var bg_r: i16 = -1;
    var bg_g: i16 = -1;
    var bg_b: i16 = -1;
    var bold: bool = false;
    var faint: bool = false;
    var italic: bool = false;
    var underline: i8 = 0;
    var strikethrough: bool = false;
    var inverse: bool = false;

    if (cell.style_id != 0) {
        const sty = page.styles.get(page.memory, cell.style_id);

        // Extract foreground color
        switch (sty.fg_color) {
            .rgb => |rgb| {
                fg_r = rgb.r;
                fg_g = rgb.g;
                fg_b = rgb.b;
            },
            .palette => |idx| {
                // Resolve palette color to RGB
                const rgb = handle.terminal.colors.palette.current[idx];
                fg_r = rgb.r;
                fg_g = rgb.g;
                fg_b = rgb.b;
            },
            .none => {},
        }

        // Extract background color
        switch (sty.bg_color) {
            .rgb => |rgb| {
                bg_r = rgb.r;
                bg_g = rgb.g;
                bg_b = rgb.b;
            },
            .palette => |idx| {
                const rgb = handle.terminal.colors.palette.current[idx];
                bg_r = rgb.r;
                bg_g = rgb.g;
                bg_b = rgb.b;
            },
            .none => {},
        }

        // Extract style flags
        bold = sty.flags.bold;
        faint = sty.flags.faint;
        italic = sty.flags.italic;
        underline = @intCast(@intFromEnum(sty.flags.underline));
        strikethrough = sty.flags.strikethrough;
        inverse = sty.flags.inverse;
    } else {
        // Handle bg-only cells (content_tag == .bg_color_palette or .bg_color_rgb)
        switch (cell.content_tag) {
            .bg_color_palette => {
                const idx = cell.content.color_palette;
                const rgb = handle.terminal.colors.palette.current[idx];
                bg_r = rgb.r;
                bg_g = rgb.g;
                bg_b = rgb.b;
            },
            .bg_color_rgb => {
                const rgb = cell.content.color_rgb;
                bg_r = rgb.r;
                bg_g = rgb.g;
                bg_b = rgb.b;
            },
            else => {},
        }
    }

    // Wide status
    const wide_val: u8 = switch (cell.wide) {
        .narrow => 0,
        .wide => 1,
        .spacer_tail => 2,
        .spacer_head => 0, // treated as narrow for our purposes
    };

    // Copy text to stable allocation
    const text = if (text_pos > 0) blk: {
        const t = allocator.alloc(u8, text_pos) catch break :blk "";
        @memcpy(t, text_buf[0..text_pos]);
        break :blk t;
    } else "";

    return .{
        .text = text,
        .fg_r = fg_r,
        .fg_g = fg_g,
        .fg_b = fg_b,
        .bg_r = bg_r,
        .bg_g = bg_g,
        .bg_b = bg_b,
        .bold = bold,
        .faint = faint,
        .italic = italic,
        .underline = underline,
        .strikethrough = strikethrough,
        .inverse = inverse,
        .wide = wide_val,
    };
}

fn defaultCell() JsCell {
    return .{
        .text = "",
        .fg_r = -1,
        .fg_g = -1,
        .fg_b = -1,
        .bg_r = -1,
        .bg_g = -1,
        .bg_b = -1,
        .bold = false,
        .faint = false,
        .italic = false,
        .underline = 0,
        .strikethrough = false,
        .inverse = false,
        .wide = 0,
    };
}

fn getCell(handle: *TerminalHandle, row: u16, col: u16) JsCell {
    return readCellAt(handle, row, col);
}

fn getLine(js: *napigen.JsContext, handle: *TerminalHandle, row: u16) !napigen.napi_value {
    const arr = try js.createArrayWithLength(handle.cols);
    for (0..handle.cols) |col| {
        const cell = readCellAt(handle, row, @intCast(col));
        try js.setElement(arr, @intCast(col), try js.write(cell));
    }
    return arr;
}

fn getLines(js: *napigen.JsContext, handle: *TerminalHandle) !napigen.napi_value {
    const arr = try js.createArrayWithLength(handle.rows);
    for (0..handle.rows) |row| {
        const line = try getLine(js, handle, @intCast(row));
        try js.setElement(arr, @intCast(row), line);
    }
    return arr;
}

// ─── Cursor ─────────────────────────────────────────────

const JsCursor = struct {
    x: u16,
    y: u16,
    visible: bool,
    style: u8, // 0=bar, 1=block, 2=underline, 3=block_hollow
};

fn getCursor(handle: *TerminalHandle) JsCursor {
    const screen = handle.terminal.screens.active;
    const cursor = &screen.cursor;

    const cursor_style: u8 = switch (cursor.cursor_style) {
        .bar => 0,
        .block => 1,
        .underline => 2,
        .block_hollow => 3,
    };

    return .{
        .x = cursor.x,
        .y = cursor.y,
        .visible = handle.terminal.modes.get(.cursor_visible),
        .style = cursor_style,
    };
}

// ─── Modes ──────────────────────────────────────────────

fn getMode(handle: *TerminalHandle, mode_name: []const u8) bool {
    if (std.mem.eql(u8, mode_name, "altScreen")) {
        return handle.terminal.modes.get(.alt_screen) or
            handle.terminal.modes.get(.alt_screen_save_cursor_clear_enter);
    }
    if (std.mem.eql(u8, mode_name, "cursorVisible")) return handle.terminal.modes.get(.cursor_visible);
    if (std.mem.eql(u8, mode_name, "bracketedPaste")) return handle.terminal.modes.get(.bracketed_paste);
    if (std.mem.eql(u8, mode_name, "applicationCursor")) return handle.terminal.modes.get(.cursor_keys);
    if (std.mem.eql(u8, mode_name, "applicationKeypad")) return handle.terminal.modes.get(.keypad_keys);
    if (std.mem.eql(u8, mode_name, "autoWrap")) return handle.terminal.modes.get(.wraparound);
    if (std.mem.eql(u8, mode_name, "mouseTracking")) return handle.terminal.modes.get(.mouse_event_normal);
    if (std.mem.eql(u8, mode_name, "focusTracking")) return handle.terminal.modes.get(.focus_event);
    if (std.mem.eql(u8, mode_name, "originMode")) return handle.terminal.modes.get(.origin);
    if (std.mem.eql(u8, mode_name, "insertMode")) return handle.terminal.modes.get(.insert);
    if (std.mem.eql(u8, mode_name, "reverseVideo")) return handle.terminal.modes.get(.reverse_colors);
    return false;
}

// ─── Title ──────────────────────────────────────────────

fn getTitle(handle: *TerminalHandle) []const u8 {
    return handle.title;
}

// ─── Scrollback ─────────────────────────────────────────

const JsScrollback = struct {
    viewport_offset: u32,
    total_lines: u32,
    screen_lines: u16,
};

fn getScrollback(handle: *TerminalHandle) JsScrollback {
    const screen = handle.terminal.screens.active;
    const pages = &screen.pages;

    // Calculate viewport offset: distance from viewport top to active area top
    const viewport_tl = pages.getTopLeft(.viewport);

    // Count rows between viewport and active area top
    var offset: u32 = 0;
    if (pages.pointFromPin(.active, viewport_tl)) |_| {
        // viewport is within or at the active area — no scrollback offset
        offset = 0;
    } else {
        // viewport is in scrollback — count rows from viewport to active
        var pin = viewport_tl;
        while (pin.down(1)) |next| {
            if (pages.pointFromPin(.active, next) != null) break;
            offset += 1;
            pin = next;
        }
        offset += 1; // include the starting row
    }

    // Total lines = all rows in the screen (scrollback + active)
    const screen_tl = pages.getTopLeft(.screen);
    var total: u32 = 1;
    {
        var pin = screen_tl;
        while (pin.down(1)) |next| {
            total += 1;
            pin = next;
        }
    }

    return .{
        .viewport_offset = offset,
        .total_lines = total,
        .screen_lines = handle.rows,
    };
}

fn scrollViewport(handle: *TerminalHandle, delta: i32) void {
    handle.terminal.scrollViewport(.{ .delta = @as(isize, delta) });
}

// ─── Colors ─────────────────────────────────────────────

const JsColors = struct {
    fg_r: u8,
    fg_g: u8,
    fg_b: u8,
    bg_r: u8,
    bg_g: u8,
    bg_b: u8,
};

fn getDefaultColors(handle: *TerminalHandle) JsColors {
    // Get foreground color — use configured or default (white)
    const fg = handle.terminal.colors.foreground.get() orelse color.RGB{ .r = 255, .g = 255, .b = 255 };
    const bg = handle.terminal.colors.background.get() orelse color.RGB{ .r = 0, .g = 0, .b = 0 };

    return .{
        .fg_r = fg.r,
        .fg_g = fg.g,
        .fg_b = fg.b,
        .bg_r = bg.r,
        .bg_g = bg.g,
        .bg_b = bg.b,
    };
}
