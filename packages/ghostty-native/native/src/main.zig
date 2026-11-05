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
const ReadonlyHandler = ghostty.ReadonlyHandler;
const StreamAction = ghostty.StreamAction;
const modes = ghostty.modes;
const point = ghostty.point;
const size = ghostty.size;

// ─── Allocator ──────────────────────────────────────────

var gpa = std.heap.GeneralPurposeAllocator(.{}){};
const allocator = gpa.allocator();

/// Copy native bytes into JS-owned storage; shared by native input encoders.
fn jsBytes(js: *napigen.JsContext, bytes: []const u8) !napigen.napi_value {
    var result: napigen.napi_value = undefined;
    try napigen.check(napigen.napi.napi_create_buffer_copy(
        js.env,
        bytes.len,
        if (bytes.len == 0) null else @ptrCast(bytes.ptr),
        null,
        &result,
    ));
    return result;
}

// ─── Reply handler ──────────────────────────────────────

/// Ghostty's readonly handler (`Terminal.vtStream()`) applies every state change but has no
/// writer, so the engine's query actions are dropped. This handler keeps the readonly handler for
/// all state changes and writes the replies Ghostty itself writes for the same actions, formatted
/// as in Ghostty 332b2aef src/termio/stream_handler.zig (requestMode :602-618, requestModeUnknown
/// :620-632, deviceStatusReport :838-870, queryKittyKeyboard :961-973, colorOperation queries
/// :1335-1414, kittyColorReport queries :1455-1545). Every other query stays silent, including the
/// size reports Ghostty answers from its window (src/termio/Termio.zig) and the answers that need
/// app state a headless terminal lacks (DA, XTVERSION, color scheme, clipboard).
/// The engine-emitted OSC 9;4 report (Ghostty 332b2aef src/terminal/osc.zig:199-213): a State enum remove=0, set=1,
/// error=2, indeterminate=3, pause=4 and an optional u8 progress, stored verbatim from stream.zig:2042-2043.
const ProgressReport = StreamAction.Value(.progress_report);

/// One engine-emitted OSC 9/777 toast (Ghostty 332b2aef src/terminal/osc.zig:94-98, emitted at stream.zig:2022-2027):
/// OSC 9 builds title "" (osc/parsers/osc9.zig:279-281), OSC 777 notify builds {title, body}
/// (osc/parsers/rxvt_extension.zig:24-43). Both strings are owned copies.
const Toast = struct {
    title: []const u8,
    body: []const u8,
};

const ResponseHandler = struct {
    readonly: ReadonlyHandler,
    title: *[]const u8,
    /// The last progress report the engine emitted; null until the first one.
    progress: *?ProgressReport,
    /// Every toast the engine emitted since the handle was created, in order.
    toasts: *std.ArrayList(Toast),
    /// Reply bytes not yet read by `readResponse`, in stream order.
    pending: std.ArrayList(u8) = .empty,
    /// The bytes handed to JS by the last `readResponse`; valid until the next read.
    read: std.ArrayList(u8) = .empty,

    pub fn deinit(self: *ResponseHandler) void {
        self.pending.deinit(allocator);
        self.read.deinit(allocator);
        self.readonly.deinit();
    }

    pub fn vt(
        self: *ResponseHandler,
        comptime action: StreamAction.Tag,
        value: StreamAction.Value(action),
    ) !void {
        const terminal = self.readonly.terminal;
        switch (action) {
            .report_pwd => try terminal.setPwd(value.url),
            .progress_report => {
                // Record the engine's emitted report verbatim, then forward it unchanged (readonly ignores it).
                self.progress.* = value;
                try self.readonly.vt(action, value);
            },
            .show_desktop_notification => {
                // Record the engine's emitted toast verbatim, then forward it unchanged (readonly ignores it).
                const title = try allocator.dupe(u8, value.title);
                errdefer allocator.free(title);
                const body = try allocator.dupe(u8, value.body);
                errdefer allocator.free(body);
                try self.toasts.append(allocator, .{ .title = title, .body = body });
                try self.readonly.vt(action, value);
            },
            .window_title => {
                // The engine validates and emits this title; never parse OSC bytes here.
                const title = try allocator.dupe(u8, value.title);
                allocator.free(self.title.*);
                self.title.* = title;
            },
            .request_mode => {
                const tag: modes.ModeTag = @bitCast(@intFromEnum(value.mode));
                const code: u8 = if (terminal.modes.get(value.mode)) 1 else 2;
                try self.reply("\x1B[{s}{};{}$y", .{ if (tag.ansi) "" else "?", tag.value, code });
            },
            .request_mode_unknown => try self.reply("\x1B[{s}{};0$y", .{ if (value.ansi) "" else "?", value.mode }),
            .device_status => switch (value.request) {
                .operating_status => try self.reply("\x1B[0n", .{}),
                .cursor_position => {
                    const cursor = terminal.screens.active.cursor;
                    const origin = terminal.modes.get(.origin);
                    const x = if (origin) cursor.x -| terminal.scrolling_region.left else cursor.x;
                    const y = if (origin) cursor.y -| terminal.scrolling_region.top else cursor.y;
                    try self.reply("\x1B[{};{}R", .{ y + 1, x + 1 });
                },
                .color_scheme => {},
            },
            .kitty_keyboard_query => try self.reply("\x1b[?{}u", .{terminal.screens.active.kitty_keyboard.current().int()}),
            .color_operation => {
                // OSC 4/5/10-19 in request order (Ghostty 332b2aef stream_handler.zig colorOperation
                // :1204-1425). Each set or reset goes to readonly alone, so a later query reads the colour
                // it left; each query reads live terminal.colors. Reports use Ghostty's shipped
                // `osc-color-report-format` default, 16-bit (src/config/Config.zig:2881); the other config
                // branches are not ported. Like termio, special, highlight, pointer and tektronix colours
                // are not reported. termio unwraps an unset foreground/background (`.?`, :1341-1344) and
                // would panic; this adapter skips only that request instead (@cto 1c6ca570), never a value.
                var it = value.requests.constIterator(0);
                while (it.next()) |request| switch (request.*) {
                    .query => |target| {
                        const colors = &terminal.colors;
                        const rgb = switch (target) {
                            .palette => |index| colors.palette.current[index],
                            .dynamic => |dynamic| switch (dynamic) {
                                .foreground => colors.foreground.get() orelse continue,
                                .background => colors.background.get() orelse continue,
                                .cursor => colors.cursor.get() orelse colors.foreground.get() orelse continue,
                                else => continue,
                            },
                            .special => continue,
                        };
                        switch (target) {
                            .palette => |index| try self.reply("\x1b]4;{d};rgb:{x:0>4}/{x:0>4}/{x:0>4}", .{
                                index,
                                @as(u16, rgb.r) * 257,
                                @as(u16, rgb.g) * 257,
                                @as(u16, rgb.b) * 257,
                            }),
                            .dynamic => |dynamic| try self.reply("\x1b]{d};rgb:{x:0>4}/{x:0>4}/{x:0>4}", .{
                                @intFromEnum(dynamic),
                                @as(u16, rgb.r) * 257,
                                @as(u16, rgb.g) * 257,
                                @as(u16, rgb.b) * 257,
                            }),
                            .special => unreachable,
                        }
                        try self.reply("{s}", .{value.terminator.string()});
                    },
                    else => {
                        var one: @TypeOf(value.requests) = .{};
                        defer one.deinit(allocator);
                        try one.append(allocator, request.*);
                        try self.readonly.vt(.color_operation, .{ .op = value.op, .requests = one, .terminator = value.terminator });
                    },
                };
            },
            .kitty_color_report => {
                // OSC 21 in request order (Ghostty 332b2aef stream_handler.zig kittyColorReport
                // :1455-1545): the first query writes the `ESC ] 21` prefix, a query for an unset colour
                // writes `;key=`, an unsupported special key is skipped after that prefix, and the reply
                // ends with the request's own terminator. Each set or reset goes to readonly alone, so a
                // later query reads the colour it left; each query reads live terminal.colors.
                var wrote = false;
                for (value.list.items) |item| switch (item) {
                    .query => |key| {
                        if (!wrote) try self.reply("\x1b]21", .{});
                        wrote = true;
                        const colors = &terminal.colors;
                        const rgb: ?ghostty.color.RGB = switch (key) {
                            .palette => |index| colors.palette.current[index],
                            .special => |special| switch (special) {
                                .foreground => colors.foreground.get(),
                                .background => colors.background.get(),
                                .cursor => colors.cursor.get(),
                                else => continue,
                            },
                        };
                        if (rgb) |c| {
                            try self.reply(";{f}=rgb:{x:0>2}/{x:0>2}/{x:0>2}", .{ key, c.r, c.g, c.b });
                        } else {
                            try self.reply(";{f}=", .{key});
                        }
                    },
                    else => {
                        var one = [_]@TypeOf(item){item};
                        try self.readonly.vt(.kitty_color_report, .{
                            .list = .{ .items = &one, .capacity = one.len },
                            .terminator = value.terminator,
                        });
                    },
                };
                if (wrote) try self.reply("{s}", .{value.terminator.string()});
            },
            else => try self.readonly.vt(action, value),
        }
    }

    fn reply(self: *ResponseHandler, comptime fmt: []const u8, args: anytype) !void {
        try self.pending.print(allocator, fmt, args);
    }
};

const ResponseStream = ghostty.Stream(ResponseHandler);

// ─── Terminal handle ────────────────────────────────────

/// Wraps a Ghostty Terminal + VT stream for the JS side.
/// The stream handles parsing of escape sequences, feeding
/// them into the terminal state machine, and buffering replies.
const TerminalHandle = struct {
    terminal: Terminal,
    stream: ResponseStream,
    cols: size.CellCountInt,
    rows: size.CellCountInt,
    title: []const u8,
    progress: ?ProgressReport,
    toasts: std.ArrayList(Toast),
};

// ─── Module init ────────────────────────────────────────

comptime {
    napigen.defineModule(initModule);
}

fn initModule(js: *napigen.JsContext, exports: napigen.napi_value) napigen.Error!napigen.napi_value {
    try js.setNamedProperty(exports, "createTerminal", try js.createFunction(createTerminal));
    try js.setNamedProperty(exports, "destroyTerminal", try js.createFunction(destroyTerminal));
    try js.setNamedProperty(exports, "feed", try js.createFunction(feed));
    try js.setNamedProperty(exports, "encodePaste", try js.createFunction(encodePaste));
    try js.setNamedProperty(exports, "encodeKey", try js.createFunction(encodeKey));
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
    try js.setNamedProperty(exports, "getCwd", try js.createFunction(getCwd));
    try js.setNamedProperty(exports, "getProgress", try js.createFunction(getProgress));
    try js.setNamedProperty(exports, "getToasts", try js.createFunction(getToasts));
    try js.setNamedProperty(exports, "getScrollback", try js.createFunction(getScrollback));
    try js.setNamedProperty(exports, "scrollViewport", try js.createFunction(scrollViewport));
    try js.setNamedProperty(exports, "getDefaultColors", try js.createFunction(getDefaultColors));
    try js.setNamedProperty(exports, "hasResponse", try js.createFunction(hasResponse));
    try js.setNamedProperty(exports, "readResponse", try js.createFunction(readResponse));
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

    handle.title = "";
    handle.progress = null;
    handle.toasts = .empty;
    handle.stream = .initAlloc(allocator, .{
        .readonly = handle.terminal.vtHandler(),
        .title = &handle.title,
        .progress = &handle.progress,
        .toasts = &handle.toasts,
    });
    handle.cols = cols;
    handle.rows = rows;

    return handle;
}

fn destroyTerminal(handle: *TerminalHandle) void {
    handle.stream.deinit();
    handle.terminal.deinit(allocator);
    if (handle.title.len > 0) {
        allocator.free(handle.title);
    }
    for (handle.toasts.items) |toast| {
        allocator.free(toast.title);
        allocator.free(toast.body);
    }
    handle.toasts.deinit(allocator);
    allocator.destroy(handle);
}

// ─── Feed / resize / reset ──────────────────────────────

fn feed(js: *napigen.JsContext, handle: *TerminalHandle, data_val: napigen.napi_value) !void {
    // Accept both strings and Uint8Array/Buffer from JS.
    // Terminal data is raw bytes (escape sequences + UTF-8 text).
    const napi = napigen.napi;
    const env = js.env;

    // Try to get data as a Node.js Buffer first
    var data_ptr: ?[*]u8 = null;
    var data_len: usize = 0;
    if (napi.napi_get_buffer_info(env, data_val, @ptrCast(&data_ptr), &data_len) == napi.napi_ok) {
        if (data_ptr) |ptr| {
            try handle.stream.nextSlice(ptr[0..data_len]);
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
            try handle.stream.nextSlice(bytes[0..typed_len]);
            return;
        }
    }

    // Fall back to string
    const str = try js.readString(data_val);
    try handle.stream.nextSlice(str);
}

/// Encode input for the existing Terminal without parsing it or touching replies.
fn encodeKey(
    js: *napigen.JsContext,
    handle: *TerminalHandle,
    key_tag: []const u8,
    utf8: []const u8,
    unshifted_codepoint: u32,
    shift: bool,
    ctrl: bool,
    alt: bool,
    super_mod: bool,
) !napigen.napi_value {
    if (unshifted_codepoint > 0x10ffff or
        (unshifted_codepoint >= 0xd800 and unshifted_codepoint <= 0xdfff))
        return error.InvalidKeyScalar;
    const view = try std.unicode.Utf8View.init(utf8);
    var iterator = view.iterator();
    var scalar_count: usize = 0;
    while (iterator.nextCodepoint() != null) scalar_count += 1;
    if (scalar_count > 1 and (shift or ctrl or alt or super_mod))
        return error.ModifiedMultiScalarKey;
    var physical = std.meta.stringToEnum(ghostty.input.Key, key_tag) orelse
        return error.UnknownKeyTag;
    if (physical == .unidentified and scalar_count == 1 and
        unshifted_codepoint >= 0x20 and unshifted_codepoint <= 0x7e)
    {
        physical = ghostty.input.Key.fromASCII(@intCast(unshifted_codepoint)) orelse .unidentified;
    }
    const event: ghostty.input.KeyEvent = .{
        .action = .press,
        .key = physical,
        .mods = .{ .shift = shift, .ctrl = ctrl, .alt = alt, .super = super_mod },
        .consumed_mods = .{},
        .composing = false,
        .utf8 = utf8,
        .unshifted_codepoint = @intCast(unshifted_codepoint),
    };
    var output = std.Io.Writer.Allocating.init(allocator);
    defer output.deinit();
    try ghostty.input.encodeKey(
        &output.writer,
        event,
        ghostty.input.KeyEncodeOptions.fromTerminal(&handle.terminal),
    );
    return jsBytes(js, output.written());
}

fn encodePaste(js: *napigen.JsContext, handle: *TerminalHandle, value: napigen.napi_value) !napigen.napi_value {
    const napi = napigen.napi;
    var kind: napi.napi_typedarray_type = undefined;
    var length: usize = 0;
    var data: ?*anyopaque = null;
    var buffer: napi.napi_value = undefined;
    var offset: usize = 0;
    try napigen.check(napi.napi_get_typedarray_info(js.env, value, &kind, &length, &data, &buffer, &offset));
    if (kind != napi.napi_uint8_array) return error.InvalidPasteBytes;
    const input: []const u8 = if (length == 0) &.{} else blk: {
        const ptr = data orelse return error.InvalidPasteBytes;
        break :blk @as([*]const u8, @ptrCast(ptr))[0..length];
    };
    const mutable = try allocator.dupe(u8, input);
    defer allocator.free(mutable);

    const parts = ghostty.input.encodePaste(mutable, ghostty.input.PasteOptions.fromTerminal(&handle.terminal));
    var output = std.Io.Writer.Allocating.init(allocator);
    defer output.deinit();
    for (parts) |part| try output.writer.writeAll(part);
    return jsBytes(js, output.written());
}

// ─── Replies ────────────────────────────────────────────

fn hasResponse(handle: *TerminalHandle) bool {
    return handle.stream.handler.pending.items.len > 0;
}

/// Hands every pending reply byte to JS (napigen copies it into a string before the next call)
/// and clears the pending buffer; null when nothing is pending.
fn readResponse(handle: *TerminalHandle) ?[]const u8 {
    const handler = &handle.stream.handler;
    if (handler.pending.items.len == 0) return null;
    std.mem.swap(std.ArrayList(u8), &handler.read, &handler.pending);
    handler.pending.clearRetainingCapacity();
    return handler.read.items;
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
    const str = try handle.terminal.screens.active.dumpStringAlloc(allocator, .{ .screen = .{} });
    return str;
}

fn getTextRange(handle: *TerminalHandle, start_row: u32, start_col: u16, end_row: u32, end_col: u16) ![]const u8 {
    // Zig 0.15: ArrayList is unmanaged, allocator passed to each call
    var result_buf: std.ArrayList(u8) = .empty;
    defer result_buf.deinit(allocator);

    const screen = handle.terminal.screens.active;
    const pages = &screen.pages;
    const total_rows = getScrollback(handle).total_lines;
    if (start_row >= total_rows or start_row > end_row) return try allocator.alloc(u8, 0);
    const last_row = @min(end_row, total_rows - 1);

    var row: u32 = start_row;
    while (row <= last_row) : (row += 1) {
        if (row > start_row) {
            try result_buf.append(allocator, '\n');
        }

        const col_start: u16 = if (row == start_row) start_col else 0;
        const col_end: u16 = @min(if (row == end_row) end_col else handle.cols, handle.cols);

        var col: u16 = col_start;
        while (col < col_end) : (col += 1) {
            const p = pages.pin(.{ .screen = .{ .x = col, .y = row } }) orelse continue;
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
    ul_r: i16,
    ul_g: i16,
    ul_b: i16,
    bold: bool,
    faint: bool,
    italic: bool,
    underline: i8, // 0=none, 1=single, 2=double, 3=curly, 4=dotted, 5=dashed
    strikethrough: bool,
    inverse: bool,
    hidden: bool,
    blink: bool,
    wide: u8, // 0=narrow, 1=wide, 2=spacer_tail
    hyperlink: ?[]const u8,
    overline: bool,
};

fn readCellAt(handle: *TerminalHandle, row: u32, col: u16) JsCell {
    const screen = handle.terminal.screens.active;
    const pages = &screen.pages;

    // Absolute rows start at the oldest retained page; pin checks columns and stops at the final active row.
    const p = pages.pin(.{ .screen = .{ .x = col, .y = row } }) orelse return defaultCell();
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
    var ul_r: i16 = -1;
    var ul_g: i16 = -1;
    var ul_b: i16 = -1;
    var bold: bool = false;
    var faint: bool = false;
    var italic: bool = false;
    var underline: i8 = 0;
    var strikethrough: bool = false;
    var inverse: bool = false;
    var hidden: bool = false;
    var blink: bool = false;
    var overline: bool = false;

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

        switch (sty.underline_color) {
            .rgb => |rgb| {
                ul_r = rgb.r;
                ul_g = rgb.g;
                ul_b = rgb.b;
            },
            .palette => |idx| {
                const rgb = handle.terminal.colors.palette.current[idx];
                ul_r = rgb.r;
                ul_g = rgb.g;
                ul_b = rgb.b;
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
        hidden = sty.flags.invisible;
        blink = sty.flags.blink;
        overline = sty.flags.overline;
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
        .ul_r = ul_r,
        .ul_g = ul_g,
        .ul_b = ul_b,
        .bold = bold,
        .faint = faint,
        .italic = italic,
        .underline = underline,
        .strikethrough = strikethrough,
        .inverse = inverse,
        .hidden = hidden,
        .blink = blink,
        .wide = wide_val,
        // napigen copies the page-owned URI into a JS string during this synchronous read.
        .hyperlink = if (page.lookupHyperlink(cell)) |id|
            page.hyperlink_set.get(page.memory, id).uri.slice(page.memory)
        else
            null,
        .overline = overline,
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
        .ul_r = -1,
        .ul_g = -1,
        .ul_b = -1,
        .bold = false,
        .faint = false,
        .italic = false,
        .underline = 0,
        .strikethrough = false,
        .inverse = false,
        .hidden = false,
        .blink = false,
        .wide = 0,
        .hyperlink = null,
        .overline = false,
    };
}

fn getCell(handle: *TerminalHandle, row: u32, col: u16) JsCell {
    return readCellAt(handle, row, col);
}

fn getLine(js: *napigen.JsContext, handle: *TerminalHandle, row: u32) !napigen.napi_value {
    const arr = try js.createArrayWithLength(handle.cols);
    for (0..handle.cols) |col| {
        const cell = readCellAt(handle, row, @intCast(col));
        try js.setElement(arr, @intCast(col), try js.write(cell));
    }
    return arr;
}

fn getLines(js: *napigen.JsContext, handle: *TerminalHandle) !napigen.napi_value {
    const total_rows = getScrollback(handle).total_lines;
    const arr = try js.createArrayWithLength(total_rows);
    for (0..total_rows) |row| {
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

fn getMode(handle: *TerminalHandle, mode_name: []const u8) ?bool {
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
    if (std.mem.eql(u8, mode_name, "altScroll")) return handle.terminal.modes.get(.mouse_alternate_scroll);
    if (std.mem.eql(u8, mode_name, "syncOutput")) return handle.terminal.modes.get(.synchronized_output);
    if (std.mem.eql(u8, mode_name, "colorSchemeReporting")) return handle.terminal.modes.get(.report_color_scheme);
    if (std.mem.eql(u8, mode_name, "smoothScroll")) return handle.terminal.modes.get(.slow_scroll);
    return null;
}

// ─── Title ──────────────────────────────────────────────

fn getTitle(handle: *TerminalHandle) []const u8 {
    return handle.title;
}

fn getCwd(handle: *TerminalHandle) ?[]const u8 {
    return handle.terminal.getPwd();
}

// ─── Progress ───────────────────────────────────────────

/// The stored report for JS: `reported` false means never reported; `value` -1 means the engine stored no
/// progress (its ?u8 is null), so the mapping back to number | null is one-to-one.
const JsProgress = struct {
    reported: bool,
    state: i32,
    value: i16,
};

fn getProgress(handle: *TerminalHandle) JsProgress {
    const report = handle.progress orelse return .{ .reported = false, .state = -1, .value = -1 };
    return .{
        .reported = true,
        .state = @intFromEnum(report.state),
        .value = if (report.progress) |progress| progress else -1,
    };
}

// ─── Toasts ─────────────────────────────────────────────

/// Every stored toast, in order, as fresh JS objects; the engine's strings are copied, never shared.
fn getToasts(js: *napigen.JsContext, handle: *TerminalHandle) !napigen.napi_value {
    const arr = try js.createArrayWithLength(@intCast(handle.toasts.items.len));
    for (handle.toasts.items, 0..) |toast, index| {
        try js.setElement(arr, @intCast(index), try js.write(toast));
    }
    return arr;
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
    fg_r: i16,
    fg_g: i16,
    fg_b: i16,
    bg_r: i16,
    bg_g: i16,
    bg_b: i16,
    cursor_r: i16,
    cursor_g: i16,
    cursor_b: i16,
};

fn getDefaultColors(handle: *TerminalHandle) JsColors {
    const fg = handle.terminal.colors.foreground.get();
    const bg = handle.terminal.colors.background.get();
    const cursor = handle.terminal.colors.cursor.get();

    return .{
        .fg_r = if (fg) |rgb| rgb.r else -1,
        .fg_g = if (fg) |rgb| rgb.g else -1,
        .fg_b = if (fg) |rgb| rgb.b else -1,
        .bg_r = if (bg) |rgb| rgb.r else -1,
        .bg_g = if (bg) |rgb| rgb.g else -1,
        .bg_b = if (bg) |rgb| rgb.b else -1,
        .cursor_r = if (cursor) |rgb| rgb.r else -1,
        .cursor_g = if (cursor) |rgb| rgb.g else -1,
        .cursor_b = if (cursor) |rgb| rgb.b else -1,
    };
}
