use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::Arc;
use tattoy_wezterm_term::{
    CellAttributes, CursorPosition, Terminal, TerminalConfiguration, TerminalSize,
};

// ═══════════════════════════════════════════════════════
// Minimal config for headless use
// ═══════════════════════════════════════════════════════

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
    cols: usize,
    rows: usize,
    title: String,
}

#[napi]
impl WeztermTerminal {
    #[napi(constructor)]
    pub fn new(cols: u32, rows: u32, scrollback_limit: Option<u32>) -> Self {
        let scrollback = scrollback_limit.unwrap_or(1000) as usize;
        let cols = cols as usize;
        let rows = rows as usize;

        let config = Arc::new(HeadlessConfig { scrollback });
        let size = TerminalSize {
            rows,
            cols,
            pixel_width: cols * 8,
            pixel_height: rows * 16,
            dpi: 0,
        };

        let term = Terminal::new(
            size,
            config,
            "termless-wezterm",
            "0.1.0",
            Box::new(Vec::new()), // Sink writer (headless)
        );

        WeztermTerminal {
            term,
            cols,
            rows,
            title: String::new(),
        }
    }

    #[napi]
    pub fn feed(&mut self, data: Buffer) {
        self.term.advance_bytes(data.as_ref());
        // Capture title from terminal state
        self.title = self.term.get_title().to_string();
    }

    #[napi]
    pub fn resize(&mut self, cols: u32, rows: u32) {
        self.cols = cols as usize;
        self.rows = rows as usize;
        let size = TerminalSize {
            rows: self.rows,
            cols: self.cols,
            pixel_width: self.cols * 8,
            pixel_height: self.rows * 16,
            dpi: 0,
        };
        self.term.resize(size);
    }

    #[napi]
    pub fn reset(&mut self) {
        // Feed RIS escape sequence
        self.term.advance_bytes(b"\x1bc");
        self.title.clear();
    }

    #[napi]
    pub fn get_text(&self) -> String {
        let screen = self.term.screen();
        let mut lines = Vec::new();

        // Scrollback lines
        let scrollback_rows = screen.scrollback_rows();
        for offset in 0..scrollback_rows {
            let phys_row = offset;
            let line = &screen.lines[phys_row];
            lines.push(line_to_string(line, self.cols));
        }

        // Visible screen lines
        for row in 0..self.rows {
            let phys_row = scrollback_rows + row;
            if phys_row < screen.lines.len() {
                let line = &screen.lines[phys_row];
                lines.push(line_to_string(line, self.cols));
            } else {
                lines.push(String::new());
            }
        }

        lines.join("\n")
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
        let scrollback_rows = screen.scrollback_rows();
        let mut parts = Vec::new();

        for row in start_row..=end_row {
            let phys = scrollback_rows as i32 + row;
            if phys < 0 || phys >= screen.lines.len() as i32 {
                continue;
            }
            let line = &screen.lines[phys as usize];
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
                let cell = line.get_cell(col);
                if let Some(cell) = cell {
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
        let scrollback_rows = screen.scrollback_rows();
        let phys = scrollback_rows + row as usize;

        if phys >= screen.lines.len() || col as usize >= self.cols {
            return empty_cell();
        }

        let line = &screen.lines[phys];
        match line.get_cell(col as usize) {
            Some(cell) => convert_cell(cell),
            None => empty_cell(),
        }
    }

    #[napi]
    pub fn get_line(&self, row: u32) -> Vec<NapiCell> {
        let screen = self.term.screen();
        let scrollback_rows = screen.scrollback_rows();
        let phys = scrollback_rows + row as usize;

        if phys >= screen.lines.len() {
            return (0..self.cols).map(|_| empty_cell()).collect();
        }

        let line = &screen.lines[phys];
        (0..self.cols)
            .map(|col| match line.get_cell(col) {
                Some(cell) => convert_cell(cell),
                None => empty_cell(),
            })
            .collect()
    }

    #[napi]
    pub fn get_cursor(&self) -> NapiCursor {
        let cursor = &self.term.cursor;
        NapiCursor {
            x: cursor.x as u32,
            y: cursor.y as u32,
            visible: true, // TODO: track DECTCEM state
            style: "block".to_string(),
        }
    }

    #[napi]
    pub fn is_alt_screen(&self) -> bool {
        self.term.is_alt_screen_active()
    }

    #[napi]
    pub fn get_mode(&self, mode: String) -> bool {
        match mode.as_str() {
            "altScreen" => self.term.is_alt_screen_active(),
            "cursorVisible" => true, // TODO: track DECTCEM
            "bracketedPaste" => self.term.bracketed_paste,
            "applicationCursor" => self.term.application_cursor_keys,
            "applicationKeypad" => self.term.dec_ansi_mode,
            "autoWrap" => self.term.dec_auto_wrap,
            "mouseTracking" => {
                self.term.mouse_tracking
                    || self.term.button_event_mouse
                    || self.term.any_event_mouse
            }
            "focusTracking" => self.term.focus_tracking,
            "originMode" => self.term.dec_origin_mode,
            "insertMode" => self.term.insert,
            "reverseVideo" => self.term.reverse_video_mode,
            _ => false,
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
            total_lines: (screen.scrollback_rows() + self.rows) as u32,
            screen_lines: self.rows as u32,
        }
    }

    #[napi]
    pub fn scroll_viewport(&mut self, _delta: i32) {
        // No-op in headless mode — no viewport scroll position to track
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

fn convert_cell(cell: &tattoy_wezterm_term::CellRef) -> NapiCell {
    let attrs = cell.attrs();
    let text = cell.str().to_string();

    // Extract foreground color
    let (fg_r, fg_g, fg_b, fg_is_default) = match attrs.foreground() {
        tattoy_wezterm_term::color::ColorAttribute::Default => (0, 0, 0, true),
        tattoy_wezterm_term::color::ColorAttribute::TrueColorWithDefaultFallback(c)
        | tattoy_wezterm_term::color::ColorAttribute::TrueColorWithPaletteFallback(c, _) => {
            let (r, g, b, _) = c.to_tuple_rgba();
            (r, g, b, false)
        }
        tattoy_wezterm_term::color::ColorAttribute::PaletteIndex(idx) => {
            // Return palette index; TypeScript side maps to RGB
            (idx, 0, 0, false) // Simplified — full palette mapping in TS
        }
    };

    // Extract background color
    let (bg_r, bg_g, bg_b, bg_is_default) = match attrs.background() {
        tattoy_wezterm_term::color::ColorAttribute::Default => (0, 0, 0, true),
        tattoy_wezterm_term::color::ColorAttribute::TrueColorWithDefaultFallback(c)
        | tattoy_wezterm_term::color::ColorAttribute::TrueColorWithPaletteFallback(c, _) => {
            let (r, g, b, _) = c.to_tuple_rgba();
            (r, g, b, false)
        }
        tattoy_wezterm_term::color::ColorAttribute::PaletteIndex(idx) => {
            (idx, 0, 0, false)
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
