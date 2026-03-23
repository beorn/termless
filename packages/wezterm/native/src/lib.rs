use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::Arc;
use tattoy_wezterm_surface::{CursorShape, CursorVisibility};
use tattoy_wezterm_term::{
    color::ColorPalette, Terminal, TerminalConfiguration, TerminalSize,
};

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
    cols: usize,
    rows: usize,
    title: String,
    // Tracked modes that lack public getters in this wezterm-term version.
    // Defaults match wezterm-term's TerminalState initialization.
    auto_wrap: bool,
    application_cursor_keys: bool,
    application_keypad: bool,
    focus_tracking: bool,
    origin_mode: bool,
    insert_mode: bool,
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
            auto_wrap: true,              // wezterm defaults to true
            application_cursor_keys: false,
            application_keypad: false,
            focus_tracking: false,
            origin_mode: false,
            insert_mode: false,
        }
    }

    #[napi]
    pub fn feed(&mut self, data: Buffer) {
        let bytes = data.as_ref();
        // Scan for DEC private mode set/reset sequences before feeding to
        // the terminal, so we can track modes that lack public getters.
        self.scan_dec_modes(bytes);
        self.term.advance_bytes(bytes);
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
        // Restore tracked mode defaults (matching wezterm-term DECSTR behavior)
        self.auto_wrap = true;
        self.application_cursor_keys = false;
        self.application_keypad = false;
        self.focus_tracking = false;
        self.origin_mode = false;
        self.insert_mode = false;
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
        match line.get_cell(col as usize) {
            Some(cell) => convert_cell(cell),
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
        (0..self.cols)
            .map(|col| match line.get_cell(col) {
                Some(cell) => convert_cell(cell),
                None => empty_cell(),
            })
            .collect()
    }

    #[napi]
    pub fn get_cursor(&self) -> NapiCursor {
        let cursor = self.term.cursor_pos();
        let visible = cursor.visibility == CursorVisibility::Visible;
        let style = match cursor.shape {
            CursorShape::Default
            | CursorShape::BlinkingBlock
            | CursorShape::SteadyBlock => "block",
            CursorShape::BlinkingUnderline
            | CursorShape::SteadyUnderline => "underline",
            CursorShape::BlinkingBar
            | CursorShape::SteadyBar => "beam",
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

    #[napi]
    pub fn get_mode(&self, mode: String) -> bool {
        match mode.as_str() {
            "altScreen" => self.term.is_alt_screen_active(),
            "cursorVisible" => {
                self.term.cursor_pos().visibility
                    == CursorVisibility::Visible
            }
            "bracketedPaste" => self.term.bracketed_paste_enabled(),
            "applicationCursor" => self.application_cursor_keys,
            "applicationKeypad" => self.application_keypad,
            "autoWrap" => self.auto_wrap,
            "mouseTracking" => self.term.is_mouse_grabbed(),
            "focusTracking" => self.focus_tracking,
            "originMode" => self.origin_mode,
            "insertMode" => self.insert_mode,
            "reverseVideo" => self.term.get_reverse_video(),
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
            total_lines: screen.scrollback_rows() as u32,
            screen_lines: self.rows as u32,
        }
    }

    #[napi]
    pub fn scroll_viewport(&mut self, _delta: i32) {
        // No-op in headless mode -- no viewport scroll position to track
    }

    /// Scan raw bytes for CSI sequences that control terminal modes
    /// lacking public getters in wezterm-term. Handles:
    /// - CSI ? <n> h/l  (DECSET/DECRST for DEC private modes)
    /// - CSI <n> h/l    (SM/RM for ANSI modes, e.g. insert mode)
    /// - ESC c           (RIS -- full reset)
    fn scan_dec_modes(&mut self, data: &[u8]) {
        let mut i = 0;
        while i < data.len() {
            if data[i] == 0x1b && i + 1 < data.len() && data[i + 1] == b'[' {
                i += 2;
                let is_private = i < data.len() && data[i] == b'?';
                if is_private {
                    i += 1;
                }
                // Parse digits
                let start = i;
                while i < data.len() && data[i].is_ascii_digit() {
                    i += 1;
                }
                if i > start && i < data.len() {
                    let code_str = std::str::from_utf8(&data[start..i]).unwrap_or("");
                    if let Ok(code) = code_str.parse::<u32>() {
                        let set = data[i] == b'h';
                        let reset = data[i] == b'l';
                        if set || reset {
                            if is_private {
                                self.apply_dec_mode(code, set);
                            } else {
                                self.apply_ansi_mode(code, set);
                            }
                        }
                    }
                }
            } else if data[i] == 0x1b && i + 1 < data.len() && data[i + 1] == b'c' {
                // RIS (full reset) -- restore defaults
                self.auto_wrap = true;
                self.application_cursor_keys = false;
                self.application_keypad = false;
                self.focus_tracking = false;
                self.origin_mode = false;
                self.insert_mode = false;
                i += 2;
            } else {
                i += 1;
            }
        }
    }

    /// Apply a DEC private mode set/reset to tracked state.
    fn apply_dec_mode(&mut self, code: u32, set: bool) {
        match code {
            1 => self.application_cursor_keys = set,   // DECCKM
            6 => self.origin_mode = set,                // DECOM
            7 => self.auto_wrap = set,                  // DECAWM
            66 => self.application_keypad = set,        // DECNKM
            1004 => self.focus_tracking = set,          // Focus tracking
            _ => {}
        }
    }

    /// Apply an ANSI mode set/reset (SM/RM without ? prefix).
    fn apply_ansi_mode(&mut self, code: u32, set: bool) {
        match code {
            4 => self.insert_mode = set, // IRM (Insert/Replace Mode)
            _ => {}
        }
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

fn convert_cell(cell: tattoy_wezterm_term::CellRef) -> NapiCell {
    let attrs = cell.attrs();
    let text = cell.str().to_string();

    // Extract foreground color
    let (fg_r, fg_g, fg_b, fg_is_default) = match attrs.foreground() {
        tattoy_wezterm_term::color::ColorAttribute::Default => (0, 0, 0, true),
        tattoy_wezterm_term::color::ColorAttribute::TrueColorWithDefaultFallback(c)
        | tattoy_wezterm_term::color::ColorAttribute::TrueColorWithPaletteFallback(c, _) => {
            let rgba: tattoy_wezterm_term::color::SrgbaTuple = c.into();
            let (r, g, b, _) = rgba.to_tuple_rgba();
            (srgba_to_u8(r), srgba_to_u8(g), srgba_to_u8(b), false)
        }
        tattoy_wezterm_term::color::ColorAttribute::PaletteIndex(idx) => {
            // Return palette index; TypeScript side maps to RGB
            (idx, 0, 0, false) // Simplified -- full palette mapping in TS
        }
    };

    // Extract background color
    let (bg_r, bg_g, bg_b, bg_is_default) = match attrs.background() {
        tattoy_wezterm_term::color::ColorAttribute::Default => (0, 0, 0, true),
        tattoy_wezterm_term::color::ColorAttribute::TrueColorWithDefaultFallback(c)
        | tattoy_wezterm_term::color::ColorAttribute::TrueColorWithPaletteFallback(c, _) => {
            let rgba: tattoy_wezterm_term::color::SrgbaTuple = c.into();
            let (r, g, b, _) = rgba.to_tuple_rgba();
            (srgba_to_u8(r), srgba_to_u8(g), srgba_to_u8(b), false)
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
