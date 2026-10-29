use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::io::Write;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use tattoy_wezterm_surface::{CursorShape, CursorVisibility};
use tattoy_wezterm_term::{color::ColorPalette, Terminal, TerminalConfiguration, TerminalSize};

struct ResponseBufferState {
    buf: Vec<u8>,
    expected_barrier: Option<Vec<u8>>,
}

#[derive(Clone)]
struct SharedWriter {
    inner: Arc<(Mutex<ResponseBufferState>, Condvar)>,
}

impl SharedWriter {
    fn new() -> Self {
        Self {
            inner: Arc::new((
                Mutex::new(ResponseBufferState {
                    buf: Vec::new(),
                    expected_barrier: None,
                }),
                Condvar::new(),
            )),
        }
    }
}

impl Write for SharedWriter {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        let (lock, _) = &*self.inner;
        let mut state = lock
            .lock()
            .map_err(|_| std::io::Error::other("wezterm SharedWriter mutex poisoned"))?;
        state.buf.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let (lock, cvar) = &*self.inner;
        let mut state = lock
            .lock()
            .map_err(|_| std::io::Error::other("wezterm SharedWriter mutex poisoned"))?;
        if let Some(ref barrier) = state.expected_barrier {
            if state.buf.ends_with(barrier) {
                let new_len = state.buf.len() - barrier.len();
                state.buf.truncate(new_len);
                state.expected_barrier = None;
                cvar.notify_all();
            }
        }
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════
// Minimal config for headless use
// ═══════════════════════════════════════════════════════

#[derive(Debug)]
struct HeadlessConfig {
    scrollback: usize,
}

impl TerminalConfiguration for HeadlessConfig {
    fn scrollback_size(&self) -> usize {
        self.scrollback
    }

    fn enable_kitty_keyboard(&self) -> bool {
        true
    }

    fn color_palette(&self) -> ColorPalette {
        ColorPalette::default()
    }
}

// ═══════════════════════════════════════════════════════
// Exported cell type
// ═══════════════════════════════════════════════════════

#[napi(object)]
pub struct NapiCell {
    pub text: String,
    pub fg_r: u8,
    pub fg_g: u8,
    pub fg_b: u8,
    pub fg_is_default: bool,
    pub bg_r: u8,
    pub bg_g: u8,
    pub bg_b: u8,
    pub bg_is_default: bool,
    pub bold: bool,
    pub faint: bool,
    pub italic: bool,
    pub underline: String,
    pub strikethrough: bool,
    pub inverse: bool,
    pub wide: bool,
}

#[napi(object)]
pub struct NapiCursor {
    pub x: u32,
    pub y: u32,
    pub visible: bool,
    pub style: String,
}

#[napi(object)]
pub struct NapiScrollback {
    pub viewport_offset: i32,
    pub total_lines: u32,
    pub screen_lines: u32,
}

// ═══════════════════════════════════════════════════════
// Terminal wrapper
// ═══════════════════════════════════════════════════════

#[napi]
pub struct WeztermTerminal {
    term: Terminal,
    writer: SharedWriter,
    barrier_seq: u64,
    cols: usize,
    rows: usize,
    cell_width: usize,
    cell_height: usize,
    title: String,
}

/// wezterm-term reads pixel_width/pixel_height as the text area: CSI 14 t and XTSMGRAPHICS report them as-is, CSI 16 t
/// and OSC 1337 ReportCellSize divide them by cols/rows. A cell size of 0 (none declared) keeps the no-display zero.
fn terminal_size(cols: usize, rows: usize, cell_width: usize, cell_height: usize) -> TerminalSize {
    TerminalSize {
        rows,
        cols,
        pixel_width: cols * cell_width,
        pixel_height: rows * cell_height,
        dpi: 0,
    }
}

#[napi]
impl WeztermTerminal {
    #[napi(constructor)]
    pub fn new(
        cols: u32,
        rows: u32,
        scrollback_limit: Option<u32>,
        cell_width: Option<u32>,
        cell_height: Option<u32>,
    ) -> Self {
        let scrollback = scrollback_limit.unwrap_or(1000) as usize;
        let cols = cols as usize;
        let rows = rows as usize;
        let cell_width = cell_width.unwrap_or(0) as usize;
        let cell_height = cell_height.unwrap_or(0) as usize;

        let config = Arc::new(HeadlessConfig { scrollback });
        let writer = SharedWriter::new();
        let term = Terminal::new(
            terminal_size(cols, rows, cell_width, cell_height),
            config,
            "termless-wezterm",
            "0.1.0",
            Box::new(writer.clone()),
        );

        WeztermTerminal {
            term,
            writer,
            barrier_seq: 0,
            cols,
            rows,
            cell_width,
            cell_height,
            title: String::new(),
        }
    }

    fn sync_responses(&mut self) -> Result<()> {
        self.barrier_seq += 1;
        let seq = self.barrier_seq;
        let barrier_token = format!("\x00__TERMLESS_WEZTERM_SYNC_{seq}__\x00");
        let expected = if self.term.bracketed_paste_enabled() {
            format!("\x1b[200~{barrier_token}\x1b[201~").into_bytes()
        } else {
            barrier_token.as_bytes().to_vec()
        };

        let (lock, cvar) = &*self.writer.inner;
        {
            let mut state = lock
                .lock()
                .map_err(|_| Error::from_reason("wezterm SharedWriter mutex poisoned"))?;
            state.expected_barrier = Some(expected);
        }
        if let Err(err) = self.term.send_paste(&barrier_token) {
            if let Ok(mut state) = lock.lock() {
                state.expected_barrier = None;
            }
            return Err(Error::from_reason(format!(
                "wezterm response barrier #{seq} send_paste failed: {err}"
            )));
        }
        let state = lock
            .lock()
            .map_err(|_| Error::from_reason("wezterm SharedWriter mutex poisoned"))?;
        let (mut state, timeout) = cvar
            .wait_timeout_while(state, Duration::from_millis(500), |s| {
                s.expected_barrier.is_some()
            })
            .map_err(|_| Error::from_reason("wezterm SharedWriter mutex poisoned"))?;
        if timeout.timed_out() && state.expected_barrier.is_some() {
            state.expected_barrier = None;
            return Err(Error::from_reason(format!(
                "wezterm response barrier #{seq} timed out after 500ms waiting for response flush"
            )));
        }
        Ok(())
    }

    #[napi]
    pub fn feed(&mut self, data: Buffer) -> Result<()> {
        let bytes = data.as_ref();
        self.term.advance_bytes(bytes);
        self.sync_responses()?;
        // Capture title from terminal state
        self.title = self.term.get_title().to_string();
        Ok(())
    }

    #[napi]
    pub fn resize(&mut self, cols: u32, rows: u32) {
        self.cols = cols as usize;
        self.rows = rows as usize;
        self.term.resize(terminal_size(self.cols, self.rows, self.cell_width, self.cell_height));
    }

    #[napi]
    pub fn reset(&mut self) -> Result<()> {
        // Feed RIS escape sequence
        self.term.advance_bytes(b"\x1bc");
        self.sync_responses()?;
        let (lock, _) = &*self.writer.inner;
        let mut state = lock
            .lock()
            .map_err(|_| Error::from_reason("wezterm SharedWriter mutex poisoned"))?;
        state.buf.clear();
        self.title.clear();
        Ok(())
    }

    #[napi]
    pub fn get_text(&self) -> String {
        let screen = self.term.screen();
        let mut lines_out = Vec::new();

        // Total lines includes scrollback + visible
        let total_lines = screen.scrollback_rows();
        let visible_rows = screen.physical_rows;
        let scrollback_count = total_lines.saturating_sub(visible_rows);

        // Iterate over all physical lines using the public API
        screen.for_each_phys_line(|idx, line| {
            if idx < scrollback_count + visible_rows {
                lines_out.push(line_to_string(line, self.cols));
            }
        });

        // Pad with empty lines if we have fewer than expected
        while lines_out.len() < scrollback_count + self.rows {
            lines_out.push(String::new());
        }

        lines_out.join("\n")
    }

    #[napi]
    pub fn get_text_range(
        &self,
        start_row: i32,
        start_col: i32,
        end_row: i32,
        end_col: i32,
    ) -> String {
        let screen = self.term.screen();
        let total_lines = screen.scrollback_rows();
        let visible_rows = screen.physical_rows;
        let scrollback_count = total_lines.saturating_sub(visible_rows);
        let mut parts = Vec::new();

        // Collect lines from the screen using for_each_phys_line
        let mut all_lines: Vec<tattoy_wezterm_term::Line> = Vec::new();
        screen.for_each_phys_line(|_idx, line| {
            all_lines.push(line.clone());
        });

        for row in start_row..=end_row {
            let phys = scrollback_count as i32 + row;
            if phys < 0 || phys >= all_lines.len() as i32 {
                continue;
            }
            let line = &all_lines[phys as usize];
            let col_start = if row == start_row {
                start_col as usize
            } else {
                0
            };
            let col_end = if row == end_row {
                end_col as usize
            } else {
                self.cols
            };

            let mut text = String::new();
            for col in col_start..col_end.min(line.len()) {
                if let Some(cell) = line.get_cell(col) {
                    text.push_str(cell.str());
                }
            }
            parts.push(text.trim_end().to_string());
        }

        parts.join("\n")
    }

    #[napi]
    pub fn get_cell(&self, row: u32, col: u32) -> NapiCell {
        let screen = self.term.screen();
        let total_lines = screen.scrollback_rows();
        let visible_rows = screen.physical_rows;
        let scrollback_count = total_lines.saturating_sub(visible_rows);
        let phys = scrollback_count + row as usize;

        if phys >= total_lines || col as usize >= self.cols {
            return empty_cell();
        }

        // Use lines_in_phys_range to get the specific line
        let lines = screen.lines_in_phys_range(phys..phys + 1);
        if lines.is_empty() {
            return empty_cell();
        }

        let line = &lines[0];
        let palette = self.term.palette();
        match line.get_cell(col as usize) {
            Some(cell) => convert_cell(cell, &palette),
            None => empty_cell(),
        }
    }

    #[napi]
    pub fn get_line(&self, row: u32) -> Vec<NapiCell> {
        let screen = self.term.screen();
        let total_lines = screen.scrollback_rows();
        let visible_rows = screen.physical_rows;
        let scrollback_count = total_lines.saturating_sub(visible_rows);
        let phys = scrollback_count + row as usize;

        if phys >= total_lines {
            return (0..self.cols).map(|_| empty_cell()).collect();
        }

        let lines = screen.lines_in_phys_range(phys..phys + 1);
        if lines.is_empty() {
            return (0..self.cols).map(|_| empty_cell()).collect();
        }

        let line = &lines[0];
        let palette = self.term.palette();
        (0..self.cols)
            .map(|col| match line.get_cell(col) {
                Some(cell) => convert_cell(cell, &palette),
                None => empty_cell(),
            })
            .collect()
    }

    #[napi]
    pub fn get_cursor(&self) -> NapiCursor {
        let cursor = self.term.cursor_pos();
        let visible = cursor.visibility == CursorVisibility::Visible;
        let style = match cursor.shape {
            CursorShape::Default | CursorShape::BlinkingBlock | CursorShape::SteadyBlock => "block",
            CursorShape::BlinkingUnderline | CursorShape::SteadyUnderline => "underline",
            CursorShape::BlinkingBar | CursorShape::SteadyBar => "beam",
        };
        NapiCursor {
            x: cursor.x as u32,
            y: cursor.y as u32,
            visible,
            style: style.to_string(),
        }
    }

    #[napi]
    pub fn is_alt_screen(&self) -> bool {
        self.term.is_alt_screen_active()
    }

    /// Check terminal mode by name. Returns None for modes that lack public
    /// getters on tattoy_wezterm_term::Terminal so callers never read shadow state.
    #[napi]
    pub fn get_mode(&self, mode: String) -> Option<bool> {
        match mode.as_str() {
            "altScreen" => Some(self.term.is_alt_screen_active()),
            "cursorVisible" => Some(self.term.cursor_pos().visibility == CursorVisibility::Visible),
            "bracketedPaste" => Some(self.term.bracketed_paste_enabled()),
            "mouseTracking" => Some(self.term.is_mouse_grabbed()),
            "reverseVideo" => Some(self.term.get_reverse_video()),
            _ => None,
        }
    }

    /// Drain pending terminal response bytes (DA1/DA2, DSR, DECRPM, window ops).
    #[napi]
    pub fn read_response(&self) -> Option<Buffer> {
        let (lock, _) = &*self.writer.inner;
        let mut state = lock.lock().ok()?;
        if state.buf.is_empty() {
            None
        } else {
            let bytes = std::mem::take(&mut state.buf);
            Some(Buffer::from(bytes))
        }
    }

    #[napi]
    pub fn get_title(&self) -> String {
        self.title.clone()
    }

    #[napi]
    pub fn get_scrollback(&self) -> NapiScrollback {
        let screen = self.term.screen();
        NapiScrollback {
            viewport_offset: 0, // Headless mode, no viewport scroll state
            total_lines: screen.scrollback_rows() as u32,
            screen_lines: self.rows as u32,
        }
    }

    #[napi]
    pub fn scroll_viewport(&mut self, _delta: i32) {
        // No-op in headless mode -- no viewport scroll position to track
    }
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

fn line_to_string(line: &tattoy_wezterm_term::Line, cols: usize) -> String {
    let mut text = String::new();
    for col in 0..cols.min(line.len()) {
        if let Some(cell) = line.get_cell(col) {
            let s = cell.str();
            if s.is_empty() {
                text.push(' ');
            } else {
                text.push_str(s);
            }
        } else {
            text.push(' ');
        }
    }
    text.trim_end().to_string()
}

fn empty_cell() -> NapiCell {
    NapiCell {
        text: String::new(),
        fg_r: 0,
        fg_g: 0,
        fg_b: 0,
        fg_is_default: true,
        bg_r: 0,
        bg_g: 0,
        bg_b: 0,
        bg_is_default: true,
        bold: false,
        faint: false,
        italic: false,
        underline: "none".to_string(),
        strikethrough: false,
        inverse: false,
        wide: false,
    }
}

/// Convert an SrgbaTuple (f32 0.0-1.0 range) to a u8 (0-255 range)
fn srgba_to_u8(v: f32) -> u8 {
    (v * 255.0).round().clamp(0.0, 255.0) as u8
}

/// The 8-bit RGB triple of a resolved color.
fn srgba_rgb(color: tattoy_wezterm_term::color::SrgbaTuple) -> (u8, u8, u8) {
    let (r, g, b, _) = color.to_tuple_rgba();
    (srgba_to_u8(r), srgba_to_u8(g), srgba_to_u8(b))
}

fn convert_cell(cell: tattoy_wezterm_term::CellRef, palette: &ColorPalette) -> NapiCell {
    let attrs = cell.attrs();
    let text = cell.str().to_string();

    // Every non-default color resolves through the terminal's palette, so an indexed color (SGR 38;5 /
    // 48;5 and the 16 ANSI names) reads back as its RGB value instead of {r: index, g: 0, b: 0}
    // (terminfo #30703). Default stays the is_default flag.
    let (fg_r, fg_g, fg_b, fg_is_default) = match attrs.foreground() {
        tattoy_wezterm_term::color::ColorAttribute::Default => (0, 0, 0, true),
        fg => {
            let (r, g, b) = srgba_rgb(palette.resolve_fg(fg));
            (r, g, b, false)
        }
    };

    let (bg_r, bg_g, bg_b, bg_is_default) = match attrs.background() {
        tattoy_wezterm_term::color::ColorAttribute::Default => (0, 0, 0, true),
        bg => {
            let (r, g, b) = srgba_rgb(palette.resolve_bg(bg));
            (r, g, b, false)
        }
    };

    // Underline style
    let underline = match attrs.underline() {
        tattoy_wezterm_term::Underline::None => "none",
        tattoy_wezterm_term::Underline::Single => "single",
        tattoy_wezterm_term::Underline::Double => "double",
        tattoy_wezterm_term::Underline::Curly => "curly",
        tattoy_wezterm_term::Underline::Dotted => "dotted",
        tattoy_wezterm_term::Underline::Dashed => "dashed",
    };

    // Bold / faint via Intensity
    let bold = matches!(attrs.intensity(), tattoy_wezterm_term::Intensity::Bold);
    let faint = matches!(attrs.intensity(), tattoy_wezterm_term::Intensity::Half);

    NapiCell {
        text,
        fg_r,
        fg_g,
        fg_b,
        fg_is_default,
        bg_r,
        bg_g,
        bg_b,
        bg_is_default,
        bold,
        faint,
        italic: attrs.italic(),
        underline: underline.to_string(),
        strikethrough: attrs.strikethrough(),
        inverse: attrs.reverse(),
        wide: cell.width() > 1,
    }
}
