//! napi-rs bridge for alacritty_terminal.
//!
//! Exposes a headless Alacritty terminal emulator to Node.js/Bun via N-API.
//! Each AlacrittyTerminal instance owns a `Term<EventProxy>` and processes
//! VT sequences synchronously.

use std::sync::Arc;
use std::sync::Mutex;

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line, Point};
use alacritty_terminal::term::cell::Flags as CellFlags;
use alacritty_terminal::term::Config;
use alacritty_terminal::term::Term;
use alacritty_terminal::vte::ansi::{Color, NamedColor, Processor};

use napi::bindgen_prelude::*;
use napi_derive::napi;

// ─── Event proxy ─────────────────────────────────────────

/// Captures terminal events (title changes, bell, etc.) for JS consumption.
#[derive(Clone)]
struct EventProxy {
    title: Arc<Mutex<String>>,
    bell_count: Arc<Mutex<u32>>,
}

impl EventProxy {
    fn new() -> Self {
        Self {
            title: Arc::new(Mutex::new(String::new())),
            bell_count: Arc::new(Mutex::new(0)),
        }
    }
}

impl EventListener for EventProxy {
    fn send_event(&self, event: Event) {
        match event {
            Event::Title(t) => {
                if let Ok(mut title) = self.title.lock() {
                    *title = t;
                }
            }
            Event::ResetTitle => {
                if let Ok(mut title) = self.title.lock() {
                    title.clear();
                }
            }
            Event::Bell => {
                if let Ok(mut count) = self.bell_count.lock() {
                    *count += 1;
                }
            }
            _ => {}
        }
    }
}

// ─── JS-visible cell data ────────────────────────────────

#[napi(object)]
pub struct JsCell {
    pub text: String,
    /// Foreground RGB as [r, g, b] or null for default
    pub fg: Option<Vec<u8>>,
    /// Background RGB as [r, g, b] or null for default
    pub bg: Option<Vec<u8>>,
    pub bold: bool,
    pub faint: bool,
    pub italic: bool,
    /// "none" | "single" | "double" | "curly" | "dotted" | "dashed"
    pub underline: String,
    pub strikethrough: bool,
    pub inverse: bool,
    pub wide: bool,
}

#[napi(object)]
pub struct JsCursor {
    pub x: u32,
    pub y: u32,
    pub visible: bool,
    /// "block" | "underline" | "beam"
    pub style: String,
}

// ─── Color conversion helpers ────────────────────────────

/// Standard 16-color ANSI palette (same as xterm defaults).
const ANSI_16: [(u8, u8, u8); 16] = [
    (0x00, 0x00, 0x00), // 0  Black
    (0x80, 0x00, 0x00), // 1  Red
    (0x00, 0x80, 0x00), // 2  Green
    (0x80, 0x80, 0x00), // 3  Yellow
    (0x00, 0x00, 0x80), // 4  Blue
    (0x80, 0x00, 0x80), // 5  Magenta
    (0x00, 0x80, 0x80), // 6  Cyan
    (0xc0, 0xc0, 0xc0), // 7  White
    (0x80, 0x80, 0x80), // 8  Bright Black
    (0xff, 0x00, 0x00), // 9  Bright Red
    (0x00, 0xff, 0x00), // 10 Bright Green
    (0xff, 0xff, 0x00), // 11 Bright Yellow
    (0x00, 0x00, 0xff), // 12 Bright Blue
    (0xff, 0x00, 0xff), // 13 Bright Magenta
    (0x00, 0xff, 0xff), // 14 Bright Cyan
    (0xff, 0xff, 0xff), // 15 Bright White
];

fn palette_256(index: u8) -> (u8, u8, u8) {
    let i = index as usize;
    if i < 16 {
        return ANSI_16[i];
    }
    if i < 232 {
        // 6x6x6 color cube
        let idx = i - 16;
        let levels: [u8; 6] = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
        let r = levels[idx / 36];
        let g = levels[(idx / 6) % 6];
        let b = levels[idx % 6];
        return (r, g, b);
    }
    // Grayscale ramp 232-255
    let v = 8 + (i - 232) as u8 * 10;
    (v, v, v)
}

fn named_color_to_index(c: NamedColor) -> u8 {
    c as u8
}

fn color_to_rgb(color: &Color) -> Option<Vec<u8>> {
    match color {
        Color::Spec(rgb) => Some(vec![rgb.r, rgb.g, rgb.b]),
        Color::Indexed(idx) => {
            let (r, g, b) = palette_256(*idx);
            Some(vec![r, g, b])
        }
        Color::Named(named) => {
            let idx = named_color_to_index(*named);
            // Named foreground/background default = null
            if idx == NamedColor::Foreground as u8 || idx == NamedColor::Background as u8 {
                return None;
            }
            let (r, g, b) = palette_256(idx);
            Some(vec![r, g, b])
        }
    }
}

fn underline_style(flags: CellFlags) -> &'static str {
    if flags.contains(CellFlags::UNDERCURL) {
        "curly"
    } else if flags.contains(CellFlags::DOUBLE_UNDERLINE) {
        "double"
    } else if flags.contains(CellFlags::DOTTED_UNDERLINE) {
        "dotted"
    } else if flags.contains(CellFlags::DASHED_UNDERLINE) {
        "dashed"
    } else if flags.contains(CellFlags::UNDERLINE) {
        "single"
    } else {
        "none"
    }
}

// ─── SizeInfo helper ─────────────────────────────────────

/// Minimal Dimensions implementation for Term construction.
struct TermSize {
    cols: usize,
    rows: usize,
}

impl Dimensions for TermSize {
    fn total_lines(&self) -> usize {
        self.rows
    }

    fn screen_lines(&self) -> usize {
        self.rows
    }

    fn columns(&self) -> usize {
        self.cols
    }
}

// ─── Main napi class ────────────────────────────────────

#[napi]
pub struct AlacrittyTerminal {
    term: Option<Term<EventProxy>>,
    proxy: EventProxy,
    processor: Processor,
    cols: usize,
    rows: usize,
}

#[napi]
impl AlacrittyTerminal {
    #[napi(constructor)]
    pub fn new(cols: u32, rows: u32, scrollback_limit: Option<u32>) -> Self {
        let proxy = EventProxy::new();
        let mut config = Config::default();
        config.scrolling_history = scrollback_limit.unwrap_or(1000) as usize;

        let size = TermSize {
            cols: cols as usize,
            rows: rows as usize,
        };

        let term = Term::new(config, &size, proxy.clone());

        Self {
            term: Some(term),
            proxy,
            processor: Processor::new(),
            cols: cols as usize,
            rows: rows as usize,
        }
    }

    /// Feed raw bytes (VT sequences) into the terminal.
    #[napi]
    pub fn feed(&mut self, data: Buffer) {
        if let Some(ref mut term) = self.term {
            for byte in data.as_ref() {
                self.processor.advance(term, &[*byte]);
            }
        }
    }

    /// Resize the terminal grid.
    #[napi]
    pub fn resize(&mut self, cols: u32, rows: u32) {
        if let Some(ref mut term) = self.term {
            self.cols = cols as usize;
            self.rows = rows as usize;
            let size = TermSize {
                cols: self.cols,
                rows: self.rows,
            };
            term.resize(size);
        }
    }

    /// Get full text content (scrollback + screen).
    #[napi]
    pub fn get_text(&self) -> String {
        let term = match &self.term {
            Some(t) => t,
            None => return String::new(),
        };

        let grid = term.grid();
        let total = grid.total_lines();
        let screen = grid.screen_lines();
        let cols = grid.columns();
        let mut lines = Vec::with_capacity(total);

        for line_idx in 0..total {
            // Grid lines: 0 = topmost scrollback, total-1 = bottom of screen
            let line = Line(-(total as i32 - screen as i32) + line_idx as i32);
            let mut text = String::with_capacity(cols);
            for col in 0..cols {
                let point = Point::new(line, Column(col));
                let cell = &grid[point];
                if cell.flags.contains(CellFlags::WIDE_CHAR_SPACER) {
                    continue;
                }
                let c = cell.c;
                if c == '\0' || c == ' ' {
                    text.push(' ');
                } else {
                    text.push(c);
                    // Append zero-width characters
                    if let Some(zerowidths) = cell.zerowidth() {
                        for &zw in zerowidths {
                            text.push(zw);
                        }
                    }
                }
            }
            lines.push(text.trim_end().to_string());
        }

        lines.join("\n")
    }

    /// Get text from a rectangular region (screen coordinates only).
    #[napi]
    pub fn get_text_range(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> String {
        let term = match &self.term {
            Some(t) => t,
            None => return String::new(),
        };

        let grid = term.grid();
        let cols = grid.columns();
        let mut parts = Vec::new();

        for row in start_row..=end_row {
            let line = Line(row as i32);
            let col_start = if row == start_row {
                start_col as usize
            } else {
                0
            };
            let col_end = if row == end_row {
                (end_col as usize).min(cols)
            } else {
                cols
            };

            let mut text = String::new();
            for col in col_start..col_end {
                let point = Point::new(line, Column(col));
                let cell = &grid[point];
                if cell.flags.contains(CellFlags::WIDE_CHAR_SPACER) {
                    continue;
                }
                let c = cell.c;
                if c == '\0' {
                    text.push(' ');
                } else {
                    text.push(c);
                    if let Some(zerowidths) = cell.zerowidth() {
                        for &zw in zerowidths {
                            text.push(zw);
                        }
                    }
                }
            }
            parts.push(text.trim_end().to_string());
        }

        parts.join("\n")
    }

    /// Get a single cell at screen coordinates (row, col).
    #[napi]
    pub fn get_cell(&self, row: u32, col: u32) -> JsCell {
        let term = match &self.term {
            Some(t) => t,
            None => {
                return JsCell {
                    text: String::new(),
                    fg: None,
                    bg: None,
                    bold: false,
                    faint: false,
                    italic: false,
                    underline: "none".to_string(),
                    strikethrough: false,
                    inverse: false,
                    wide: false,
                };
            }
        };

        let grid = term.grid();
        let point = Point::new(Line(row as i32), Column(col as usize));
        let cell = &grid[point];
        let flags = cell.flags;

        let mut text = String::new();
        let c = cell.c;
        if c != '\0' {
            text.push(c);
            if let Some(zerowidths) = cell.zerowidth() {
                for &zw in zerowidths {
                    text.push(zw);
                }
            }
        }

        JsCell {
            text,
            fg: color_to_rgb(&cell.fg),
            bg: color_to_rgb(&cell.bg),
            bold: flags.contains(CellFlags::BOLD),
            faint: flags.contains(CellFlags::DIM),
            italic: flags.contains(CellFlags::ITALIC),
            underline: underline_style(flags).to_string(),
            strikethrough: flags.contains(CellFlags::STRIKEOUT),
            inverse: flags.contains(CellFlags::INVERSE),
            wide: flags.contains(CellFlags::WIDE_CHAR),
        }
    }

    /// Get all cells in a row as an array.
    #[napi]
    pub fn get_line(&self, row: u32) -> Vec<JsCell> {
        let mut cells = Vec::with_capacity(self.cols);
        for col in 0..self.cols as u32 {
            cells.push(self.get_cell(row, col));
        }
        cells
    }

    /// Get all screen rows.
    #[napi]
    pub fn get_lines(&self) -> Vec<Vec<JsCell>> {
        let mut rows = Vec::with_capacity(self.rows);
        for row in 0..self.rows as u32 {
            rows.push(self.get_line(row));
        }
        rows
    }

    /// Get cursor position and state.
    #[napi]
    pub fn get_cursor(&self) -> JsCursor {
        let term = match &self.term {
            Some(t) => t,
            None => {
                return JsCursor {
                    x: 0,
                    y: 0,
                    visible: true,
                    style: "block".to_string(),
                };
            }
        };

        let cursor = term.grid().cursor.clone();
        let style = match term.cursor_style().shape {
            alacritty_terminal::vte::ansi::CursorShape::Block => "block",
            alacritty_terminal::vte::ansi::CursorShape::Underline => "underline",
            alacritty_terminal::vte::ansi::CursorShape::Beam => "beam",
            _ => "block",
        };

        // Check DECTCEM (cursor visible mode)
        let visible = term
            .mode()
            .contains(alacritty_terminal::term::TermMode::SHOW_CURSOR);

        JsCursor {
            x: cursor.point.column.0 as u32,
            y: cursor.point.line.0 as u32,
            visible,
            style: style.to_string(),
        }
    }

    /// Check terminal mode by name.
    #[napi]
    pub fn get_mode(&self, mode: String) -> bool {
        let term = match &self.term {
            Some(t) => t,
            None => return false,
        };

        let term_mode = term.mode();

        match mode.as_str() {
            "altScreen" => term_mode.contains(alacritty_terminal::term::TermMode::ALT_SCREEN),
            "cursorVisible" => {
                term_mode.contains(alacritty_terminal::term::TermMode::SHOW_CURSOR)
            }
            "bracketedPaste" => {
                term_mode.contains(alacritty_terminal::term::TermMode::BRACKETED_PASTE)
            }
            "applicationCursor" => {
                term_mode.contains(alacritty_terminal::term::TermMode::APP_CURSOR)
            }
            "applicationKeypad" => {
                term_mode.contains(alacritty_terminal::term::TermMode::APP_KEYPAD)
            }
            "autoWrap" => term_mode.contains(alacritty_terminal::term::TermMode::LINE_WRAP),
            "mouseTracking" => {
                term_mode.intersects(
                    alacritty_terminal::term::TermMode::MOUSE_REPORT_CLICK
                        | alacritty_terminal::term::TermMode::MOUSE_DRAG
                        | alacritty_terminal::term::TermMode::MOUSE_MOTION
                        | alacritty_terminal::term::TermMode::MOUSE_MODE,
                )
            }
            "focusTracking" => {
                term_mode.contains(alacritty_terminal::term::TermMode::FOCUS_IN_OUT)
            }
            "originMode" => term_mode.contains(alacritty_terminal::term::TermMode::ORIGIN),
            "insertMode" => term_mode.contains(alacritty_terminal::term::TermMode::INSERT),
            "reverseVideo" => {
                // alacritty_terminal tracks SGR reverse per-cell, not as a global mode
                false
            }
            _ => false,
        }
    }

    /// Get the terminal title (set via OSC 0/2).
    #[napi]
    pub fn get_title(&self) -> String {
        self.proxy
            .title
            .lock()
            .map(|t| t.clone())
            .unwrap_or_default()
    }

    /// Get scrollback state.
    #[napi]
    pub fn get_scrollback(&self) -> Vec<u32> {
        let term = match &self.term {
            Some(t) => t,
            None => return vec![0, 0, 0],
        };

        let grid = term.grid();
        let display_offset = grid.display_offset() as u32;
        let total_lines = grid.total_lines() as u32;
        let screen_lines = grid.screen_lines() as u32;

        // Return [viewportOffset, totalLines, screenLines]
        vec![display_offset, total_lines, screen_lines]
    }

    /// Scroll the viewport by delta lines (positive = down/towards recent).
    #[napi]
    pub fn scroll_viewport(&mut self, delta: i32) {
        if let Some(ref mut term) = self.term {
            use alacritty_terminal::grid::Scroll;
            if delta > 0 {
                term.scroll_display(Scroll::Delta(delta));
            } else if delta < 0 {
                term.scroll_display(Scroll::Delta(delta));
            }
        }
    }

    /// Clean up the terminal.
    #[napi]
    pub fn destroy(&mut self) {
        self.term = None;
    }
}
