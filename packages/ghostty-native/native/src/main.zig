/// N-API bindings for libghostty-vt — Ghostty's terminal emulation core.
///
/// Exposes a headless Ghostty terminal to Node.js/Bun via napigen.
/// Uses the render state API for efficient cell-by-cell reading.
const std = @import("std");
const napigen = @import("napigen");
const c = @cImport({
    @cInclude("ghostty/vt.h");
});

// ─── Allocator ──────────────────────────────────────────

var gpa = std.heap.GeneralPurposeAllocator(.{}){};
const allocator = gpa.allocator();

// ─── Terminal handle ────────────────────────────────────

/// Wraps a GhosttyTerminal + GhosttyRenderState for the JS side.
const TerminalHandle = struct {
    terminal: c.GhosttyTerminal,
    render_state: c.GhosttyRenderState,
    row_iterator: c.GhosttyRenderStateRowIterator,
    row_cells: c.GhosttyRenderStateRowCells,
    cols: u16,
    rows: u16,
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
    var terminal: c.GhosttyTerminal = null;
    const opts = c.GhosttyTerminalOptions{
        .cols = cols,
        .rows = rows,
        .max_scrollback = @as(usize, max_scrollback),
    };

    const result = c.ghostty_terminal_new(null, &terminal, opts);
    if (result != c.GHOSTTY_SUCCESS) return error.TerminalCreationFailed;

    // Create render state
    var render_state: c.GhosttyRenderState = null;
    const rs_result = c.ghostty_render_state_new(null, &render_state);
    if (rs_result != c.GHOSTTY_SUCCESS) {
        c.ghostty_terminal_free(terminal);
        return error.RenderStateCreationFailed;
    }

    // Create reusable row iterator
    var row_iterator: c.GhosttyRenderStateRowIterator = null;
    const ri_result = c.ghostty_render_state_row_iterator_new(null, &row_iterator);
    if (ri_result != c.GHOSTTY_SUCCESS) {
        c.ghostty_render_state_free(render_state);
        c.ghostty_terminal_free(terminal);
        return error.RowIteratorCreationFailed;
    }

    // Create reusable row cells
    var row_cells: c.GhosttyRenderStateRowCells = null;
    const rc_result = c.ghostty_render_state_row_cells_new(null, &row_cells);
    if (rc_result != c.GHOSTTY_SUCCESS) {
        c.ghostty_render_state_row_iterator_free(row_iterator);
        c.ghostty_render_state_free(render_state);
        c.ghostty_terminal_free(terminal);
        return error.RowCellsCreationFailed;
    }

    const handle = allocator.create(TerminalHandle) catch return error.OutOfMemory;
    handle.* = .{
        .terminal = terminal,
        .render_state = render_state,
        .row_iterator = row_iterator,
        .row_cells = row_cells,
        .cols = cols,
        .rows = rows,
        .title = "",
    };
    return handle;
}

fn destroyTerminal(handle: *TerminalHandle) void {
    c.ghostty_render_state_row_cells_free(handle.row_cells);
    c.ghostty_render_state_row_iterator_free(handle.row_iterator);
    c.ghostty_render_state_free(handle.render_state);
    c.ghostty_terminal_free(handle.terminal);
    allocator.destroy(handle);
}

// ─── Feed / resize / reset ──────────────────────────────

fn feed(handle: *TerminalHandle, data: []const u8) void {
    c.ghostty_terminal_vt_write(handle.terminal, data.ptr, data.len);
    // Update render state after writing
    _ = c.ghostty_render_state_update(handle.render_state, handle.terminal);
}

fn resizeTerm(handle: *TerminalHandle, cols: u16, rows: u16) void {
    _ = c.ghostty_terminal_resize(handle.terminal, cols, rows);
    handle.cols = cols;
    handle.rows = rows;
    _ = c.ghostty_render_state_update(handle.render_state, handle.terminal);
}

fn resetTerm(handle: *TerminalHandle) void {
    c.ghostty_terminal_reset(handle.terminal);
    _ = c.ghostty_render_state_update(handle.render_state, handle.terminal);
}

// ─── Text extraction ────────────────────────────────────

fn getText(handle: *TerminalHandle) ![]const u8 {
    // Use the formatter API for plain text extraction
    var formatter: c.GhosttyFormatter = null;
    var opts: c.GhosttyFormatterTerminalOptions = .{
        .size = @sizeOf(c.GhosttyFormatterTerminalOptions),
        .emit = c.GHOSTTY_FORMATTER_FORMAT_PLAIN,
        .unwrap = false,
        .trim = true,
        .extra = std.mem.zeroes(c.GhosttyFormatterTerminalExtra),
    };
    opts.extra.size = @sizeOf(c.GhosttyFormatterTerminalExtra);

    const fmt_result = c.ghostty_formatter_terminal_new(null, &formatter, handle.terminal, opts);
    if (fmt_result != c.GHOSTTY_SUCCESS) return error.FormatterCreationFailed;
    defer c.ghostty_formatter_free(formatter);

    // Query required size
    var required_len: usize = 0;
    _ = c.ghostty_formatter_format_buf(formatter, null, 0, &required_len);

    if (required_len == 0) return "";

    // Allocate and format
    const buf = allocator.alloc(u8, required_len) catch return error.OutOfMemory;
    defer allocator.free(buf);

    var written: usize = 0;
    const result = c.ghostty_formatter_format_buf(formatter, buf.ptr, buf.len, &written);
    if (result != c.GHOSTTY_SUCCESS) return error.FormatFailed;

    // Return a copy that napigen can manage
    const out = allocator.alloc(u8, written) catch return error.OutOfMemory;
    @memcpy(out, buf[0..written]);
    return out;
}

fn getTextRange(handle: *TerminalHandle, start_row: u16, start_col: u16, end_row: u16, end_col: u16) ![]const u8 {
    // Build text by iterating cells in the range using grid refs
    var result_buf = std.ArrayList(u8).init(allocator);
    defer result_buf.deinit();

    _ = c.ghostty_render_state_update(handle.render_state, handle.terminal);

    // Get row iterator
    _ = c.ghostty_render_state_get(
        handle.render_state,
        c.GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR,
        @ptrCast(&handle.row_iterator),
    );

    var current_row: u16 = 0;
    while (c.ghostty_render_state_row_iterator_next(handle.row_iterator)) {
        if (current_row > end_row) break;
        if (current_row >= start_row) {
            if (current_row > start_row) {
                try result_buf.append('\n');
            }

            // Get cells for this row
            _ = c.ghostty_render_state_row_get(
                handle.row_iterator,
                c.GHOSTTY_RENDER_STATE_ROW_DATA_CELLS,
                @ptrCast(&handle.row_cells),
            );

            const col_start: u16 = if (current_row == start_row) start_col else 0;
            const col_end: u16 = if (current_row == end_row) end_col else handle.cols;

            var col: u16 = 0;
            while (c.ghostty_render_state_row_cells_next(handle.row_cells)) {
                if (col >= col_end) break;
                if (col >= col_start) {
                    try appendCellText(&result_buf, handle.row_cells);
                }
                col += 1;
            }
        }
        current_row += 1;
    }

    // Trim trailing whitespace per line
    const out = try allocator.alloc(u8, result_buf.items.len);
    @memcpy(out, result_buf.items);
    return out;
}

fn appendCellText(buf: *std.ArrayList(u8), row_cells: c.GhosttyRenderStateRowCells) !void {
    // Get grapheme length
    var grapheme_len: u32 = 0;
    const len_result = c.ghostty_render_state_row_cells_get(
        row_cells,
        c.GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN,
        @ptrCast(&grapheme_len),
    );
    if (len_result != c.GHOSTTY_SUCCESS or grapheme_len == 0) {
        try buf.append(' ');
        return;
    }

    // Get codepoints
    var codepoints: [16]u32 = undefined;
    const cp_result = c.ghostty_render_state_row_cells_get(
        row_cells,
        c.GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF,
        @ptrCast(&codepoints),
    );
    if (cp_result != c.GHOSTTY_SUCCESS) {
        try buf.append(' ');
        return;
    }

    // Encode codepoints as UTF-8
    const len = @min(grapheme_len, 16);
    for (codepoints[0..len]) |cp| {
        if (cp == 0) {
            try buf.append(' ');
        } else {
            var utf8_buf: [4]u8 = undefined;
            const utf8_len = std.unicode.utf8Encode(@intCast(cp), &utf8_buf) catch {
                try buf.append('?');
                continue;
            };
            try buf.appendSlice(utf8_buf[0..utf8_len]);
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
    // Use grid_ref for single cell access
    var grid_ref: c.GhosttyGridRef = .{
        .size = @sizeOf(c.GhosttyGridRef),
        .node = null,
        .x = 0,
        .y = 0,
    };

    const point = c.GhosttyPoint{
        .tag = c.GHOSTTY_POINT_TAG_VIEWPORT,
        .value = .{ .coordinate = .{ .x = col, .y = row } },
    };

    const result = c.ghostty_terminal_grid_ref(handle.terminal, point, &grid_ref);
    if (result != c.GHOSTTY_SUCCESS) return defaultCell();

    // Get cell
    var cell: c.GhosttyCell = 0;
    _ = c.ghostty_grid_ref_cell(&grid_ref, &cell);

    // Get style
    var style: c.GhosttyStyle = std.mem.zeroes(c.GhosttyStyle);
    style.size = @sizeOf(c.GhosttyStyle);
    _ = c.ghostty_grid_ref_style(&grid_ref, &style);

    // Get wide status
    var wide_val: c.GhosttyCellWide = c.GHOSTTY_CELL_WIDE_NARROW;
    _ = c.ghostty_cell_get(cell, c.GHOSTTY_CELL_DATA_WIDE, @ptrCast(&wide_val));

    // Get codepoint
    var codepoint: u32 = 0;
    _ = c.ghostty_cell_get(cell, c.GHOSTTY_CELL_DATA_CODEPOINT, @ptrCast(&codepoint));

    // Get graphemes
    var grapheme_buf: [16]u32 = undefined;
    var grapheme_len: usize = 0;
    _ = c.ghostty_grid_ref_graphemes(&grid_ref, &grapheme_buf, 16, &grapheme_len);

    // Build text
    var text_buf: [64]u8 = undefined;
    var text_pos: usize = 0;

    if (grapheme_len > 0) {
        for (grapheme_buf[0..grapheme_len]) |cp| {
            if (cp == 0) continue;
            const utf8_len = std.unicode.utf8Encode(@intCast(cp), text_buf[text_pos..][0..4]) catch continue;
            text_pos += utf8_len;
        }
    } else if (codepoint != 0) {
        const utf8_len = std.unicode.utf8Encode(@intCast(codepoint), text_buf[0..4]) catch 0;
        text_pos = utf8_len;
    }

    // Extract colors
    var fg_r: i16 = -1;
    var fg_g: i16 = -1;
    var fg_b: i16 = -1;
    var bg_r: i16 = -1;
    var bg_g: i16 = -1;
    var bg_b: i16 = -1;

    if (style.fg_color.tag == c.GHOSTTY_STYLE_COLOR_RGB) {
        fg_r = style.fg_color.value.rgb.r;
        fg_g = style.fg_color.value.rgb.g;
        fg_b = style.fg_color.value.rgb.b;
    } else if (style.fg_color.tag == c.GHOSTTY_STYLE_COLOR_PALETTE) {
        // Resolve palette color through render state
        fg_r = -1; // Will be resolved in TypeScript via getDefaultColors
        fg_g = -1;
        fg_b = -1;
    }

    if (style.bg_color.tag == c.GHOSTTY_STYLE_COLOR_RGB) {
        bg_r = style.bg_color.value.rgb.r;
        bg_g = style.bg_color.value.rgb.g;
        bg_b = style.bg_color.value.rgb.b;
    }

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
        .bold = style.bold,
        .faint = style.faint,
        .italic = style.italic,
        .underline = @intCast(style.underline),
        .strikethrough = style.strikethrough,
        .inverse = style.inverse,
        .wide = @intCast(@intFromEnum(wide_val)),
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
    const arr = try js.createArray(handle.cols);
    for (0..handle.cols) |col| {
        const cell = readCellAt(handle, row, @intCast(col));
        try js.setElement(arr, @intCast(col), try js.write(cell));
    }
    return arr;
}

fn getLines(js: *napigen.JsContext, handle: *TerminalHandle) !napigen.napi_value {
    const arr = try js.createArray(handle.rows);
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
    _ = c.ghostty_render_state_update(handle.render_state, handle.terminal);

    var x: u16 = 0;
    var y: u16 = 0;
    var visible: bool = true;
    var visual_style: c.GhosttyRenderStateCursorVisualStyle = c.GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BLOCK;
    var has_viewport: bool = false;

    _ = c.ghostty_render_state_get(handle.render_state, c.GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_HAS_VALUE, @ptrCast(&has_viewport));
    if (has_viewport) {
        _ = c.ghostty_render_state_get(handle.render_state, c.GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_X, @ptrCast(&x));
        _ = c.ghostty_render_state_get(handle.render_state, c.GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_Y, @ptrCast(&y));
    }

    _ = c.ghostty_render_state_get(handle.render_state, c.GHOSTTY_RENDER_STATE_DATA_CURSOR_VISIBLE, @ptrCast(&visible));
    _ = c.ghostty_render_state_get(handle.render_state, c.GHOSTTY_RENDER_STATE_DATA_CURSOR_VISUAL_STYLE, @ptrCast(&visual_style));

    return .{
        .x = x,
        .y = y,
        .visible = visible,
        .style = @intCast(@intFromEnum(visual_style)),
    };
}

// ─── Modes ──────────────────────────────────────────────

fn getMode(handle: *TerminalHandle, mode_name: []const u8) bool {
    const mode: c.GhosttyMode = modeFromName(mode_name) orelse return false;
    var value: bool = false;
    const result = c.ghostty_terminal_mode_get(handle.terminal, mode, &value);
    if (result != c.GHOSTTY_SUCCESS) return false;
    return value;
}

fn modeFromName(name: []const u8) ?c.GhosttyMode {
    if (std.mem.eql(u8, name, "altScreen")) return c.GHOSTTY_MODE_ALT_SCREEN;
    if (std.mem.eql(u8, name, "cursorVisible")) return c.GHOSTTY_MODE_CURSOR_VISIBLE;
    if (std.mem.eql(u8, name, "bracketedPaste")) return c.GHOSTTY_MODE_BRACKETED_PASTE;
    if (std.mem.eql(u8, name, "applicationCursor")) return c.GHOSTTY_MODE_DECCKM;
    if (std.mem.eql(u8, name, "applicationKeypad")) return c.GHOSTTY_MODE_KEYPAD_KEYS;
    if (std.mem.eql(u8, name, "autoWrap")) return c.GHOSTTY_MODE_WRAPAROUND;
    if (std.mem.eql(u8, name, "mouseTracking")) return c.GHOSTTY_MODE_NORMAL_MOUSE;
    if (std.mem.eql(u8, name, "focusTracking")) return c.GHOSTTY_MODE_FOCUS_EVENT;
    if (std.mem.eql(u8, name, "originMode")) return c.GHOSTTY_MODE_ORIGIN;
    if (std.mem.eql(u8, name, "insertMode")) return c.GHOSTTY_MODE_INSERT;
    if (std.mem.eql(u8, name, "reverseVideo")) return c.GHOSTTY_MODE_REVERSE_COLORS;
    return null;
}

// ─── Title ──────────────────────────────────────────────

fn getTitle(handle: *TerminalHandle) []const u8 {
    return handle.title;
}

// ─── Scrollback ─────────────────────────────────────────

const JsScrollback = struct {
    viewport_offset: u64,
    total_lines: u64,
    screen_lines: u16,
};

fn getScrollback(handle: *TerminalHandle) JsScrollback {
    var scrollbar: c.GhosttyTerminalScrollbar = .{
        .total = 0,
        .offset = 0,
        .len = 0,
    };
    _ = c.ghostty_terminal_get(handle.terminal, c.GHOSTTY_TERMINAL_DATA_SCROLLBAR, @ptrCast(&scrollbar));

    return .{
        .viewport_offset = scrollbar.offset,
        .total_lines = scrollbar.total,
        .screen_lines = handle.rows,
    };
}

fn scrollViewport(handle: *TerminalHandle, delta: i32) void {
    const behavior = c.GhosttyTerminalScrollViewport{
        .tag = c.GHOSTTY_SCROLL_VIEWPORT_DELTA,
        .value = .{ .delta = @intCast(delta) },
    };
    c.ghostty_terminal_scroll_viewport(handle.terminal, behavior);
    _ = c.ghostty_render_state_update(handle.render_state, handle.terminal);
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
    _ = c.ghostty_render_state_update(handle.render_state, handle.terminal);

    var fg: c.GhosttyColorRgb = .{ .r = 0, .g = 0, .b = 0 };
    var bg: c.GhosttyColorRgb = .{ .r = 0, .g = 0, .b = 0 };

    _ = c.ghostty_render_state_get(handle.render_state, c.GHOSTTY_RENDER_STATE_DATA_COLOR_FOREGROUND, @ptrCast(&fg));
    _ = c.ghostty_render_state_get(handle.render_state, c.GHOSTTY_RENDER_STATE_DATA_COLOR_BACKGROUND, @ptrCast(&bg));

    return .{
        .fg_r = fg.r,
        .fg_g = fg.g,
        .fg_b = fg.b,
        .bg_r = bg.r,
        .bg_g = bg.g,
        .bg_b = bg.b,
    };
}
