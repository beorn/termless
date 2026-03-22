use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::Mutex;

// ===============================================================
// Standard 256-color palette (indices 0..=255) → RGB
// ===============================================================

/// Convert a 256-color palette index to (r, g, b).
fn palette_index_to_rgb(idx: u8) -> (u8, u8, u8) {
    match idx {
        // Standard 16 colors (ANSI)
        0 => (0, 0, 0),
        1 => (128, 0, 0),
        2 => (0, 128, 0),
        3 => (128, 128, 0),
        4 => (0, 0, 128),
        5 => (128, 0, 128),
        6 => (0, 128, 128),
        7 => (192, 192, 192),
        8 => (128, 128, 128),
        9 => (255, 0, 0),
        10 => (0, 255, 0),
        11 => (255, 255, 0),
        12 => (0, 0, 255),
        13 => (255, 0, 255),
        14 => (0, 255, 255),
        15 => (255, 255, 255),
        // 6x6x6 color cube (indices 16..=231)
        16..=231 => {
            let n = idx - 16;
            let b = n % 6;
            let g = (n / 6) % 6;
            let r = n / 36;
            let to_val = |c: u8| if c == 0 { 0u8 } else { 55 + 40 * c };
            (to_val(r), to_val(g), to_val(b))
        }
        // Grayscale ramp (indices 232..=255)
        232..=255 => {
            let v = 8 + 10 * (idx - 232);
            (v, v, v)
        }
    }
}

// ===============================================================
// Exported cell type
// ===============================================================

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

// ===============================================================
// Terminal wrapper
// ===============================================================

#[napi]
pub struct Vt100RustTerminal {
    parser: Mutex<vt100::Parser>,
    cols: u16,
    rows: u16,
    title: Mutex<String>,
}

#[napi]
impl Vt100RustTerminal {
    #[napi(constructor)]
    pub fn new(cols: u32, rows: u32, scrollback_limit: Option<u32>) -> Self {
        let scrollback = scrollback_limit.unwrap_or(1000) as usize;
        let r = rows as u16;
        let c = cols as u16;

        let parser = vt100::Parser::new(r, c, scrollback);

        Vt100RustTerminal {
            parser: Mutex::new(parser),
            cols: c,
            rows: r,
            title: Mutex::new(String::new()),
        }
    }

    #[napi]
    pub fn feed(&self, data: Buffer) -> Result<()> {
        let mut parser = self.parser.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock parser: {}", e))
        })?;
        parser.process(data.as_ref());
        // Capture title from terminal state
        let title = parser.screen().title().to_string();
        let mut t = self.title.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock title: {}", e))
        })?;
        *t = title;
        Ok(())
    }

    #[napi]
    pub fn resize(&self, cols: u32, rows: u32) -> Result<()> {
        let mut parser = self.parser.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock parser: {}", e))
        })?;
        parser.set_size(rows as u16, cols as u16);
        Ok(())
    }

    #[napi]
    pub fn reset(&self) -> Result<()> {
        let mut parser = self.parser.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock parser: {}", e))
        })?;
        // Feed RIS escape sequence to reset
        parser.process(b"\x1bc");
        let mut t = self.title.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock title: {}", e))
        })?;
        t.clear();
        Ok(())
    }

    #[napi]
    pub fn get_text(&self) -> Result<String> {
        let parser = self.parser.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock parser: {}", e))
        })?;
        let screen = parser.screen();
        let mut lines = Vec::new();

        // Scrollback lines
        let scrollback_len = screen.scrollback();
        for row_offset in 0..scrollback_len {
            // Scrollback rows are indexed negatively from the top of the screen
            let neg_row = -(scrollback_len as i32) + row_offset as i32;
            let row_idx = neg_row as i32;
            let mut line = String::new();
            for col in 0..self.cols {
                if let Some(cell) = screen.cell(row_idx as u16, col) {
                    let contents = cell.contents();
                    if contents.is_empty() {
                        line.push(' ');
                    } else {
                        line.push_str(contents);
                    }
                } else {
                    line.push(' ');
                }
            }
            lines.push(line.trim_end().to_string());
        }

        // Visible screen lines
        for row in 0..self.rows {
            let mut line = String::new();
            for col in 0..self.cols {
                if let Some(cell) = screen.cell(row, col) {
                    let contents = cell.contents();
                    if contents.is_empty() {
                        line.push(' ');
                    } else {
                        line.push_str(contents);
                    }
                } else {
                    line.push(' ');
                }
            }
            lines.push(line.trim_end().to_string());
        }

        Ok(lines.join("\n"))
    }

    #[napi]
    pub fn get_text_range(
        &self,
        start_row: i32,
        start_col: i32,
        end_row: i32,
        end_col: i32,
    ) -> Result<String> {
        let parser = self.parser.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock parser: {}", e))
        })?;
        let screen = parser.screen();
        let mut parts = Vec::new();

        for row in start_row..=end_row {
            if row < 0 || row >= self.rows as i32 {
                continue;
            }
            let col_start = if row == start_row {
                start_col as u16
            } else {
                0
            };
            let col_end = if row == end_row {
                end_col as u16
            } else {
                self.cols
            };

            let mut text = String::new();
            for col in col_start..col_end.min(self.cols) {
                if let Some(cell) = screen.cell(row as u16, col) {
                    let contents = cell.contents();
                    if contents.is_empty() {
                        text.push(' ');
                    } else {
                        text.push_str(contents);
                    }
                } else {
                    text.push(' ');
                }
            }
            parts.push(text.trim_end().to_string());
        }

        Ok(parts.join("\n"))
    }

    #[napi]
    pub fn get_cell(&self, row: i32, col: i32) -> Result<NapiCell> {
        let parser = self.parser.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock parser: {}", e))
        })?;
        let screen = parser.screen();

        if row < 0 || row >= self.rows as i32 || col < 0 || col >= self.cols as i32 {
            return Ok(empty_cell());
        }

        match screen.cell(row as u16, col as u16) {
            Some(cell) => Ok(convert_cell(cell)),
            None => Ok(empty_cell()),
        }
    }

    #[napi]
    pub fn get_line(&self, row: i32) -> Result<Vec<NapiCell>> {
        let parser = self.parser.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock parser: {}", e))
        })?;
        let screen = parser.screen();

        if row < 0 || row >= self.rows as i32 {
            return Ok((0..self.cols).map(|_| empty_cell()).collect());
        }

        Ok((0..self.cols)
            .map(|col| match screen.cell(row as u16, col) {
                Some(cell) => convert_cell(cell),
                None => empty_cell(),
            })
            .collect())
    }

    #[napi]
    pub fn get_cursor(&self) -> Result<NapiCursor> {
        let parser = self.parser.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock parser: {}", e))
        })?;
        let screen = parser.screen();
        let (row, col) = screen.cursor_position();

        Ok(NapiCursor {
            x: col as u32,
            y: row as u32,
            visible: !screen.hide_cursor(),
            style: "block".to_string(),
        })
    }

    #[napi]
    pub fn get_mode(&self, mode: String) -> Result<bool> {
        let parser = self.parser.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock parser: {}", e))
        })?;
        let screen = parser.screen();

        Ok(match mode.as_str() {
            "altScreen" => screen.alternate_screen(),
            "cursorVisible" => !screen.hide_cursor(),
            "bracketedPaste" => screen.bracketed_paste(),
            "applicationCursor" => screen.application_cursor(),
            "applicationKeypad" => screen.application_keypad(),
            "mouseTracking" => screen.mouse_protocol_mode() != vt100::MouseProtocolMode::None,
            // Modes not directly exposed by the vt100 crate
            "autoWrap" => true,  // Default on, not queryable
            "focusTracking" => false,
            "originMode" => false,
            "insertMode" => false,
            "reverseVideo" => false,
            _ => false,
        })
    }

    #[napi]
    pub fn get_title(&self) -> Result<String> {
        let t = self.title.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock title: {}", e))
        })?;
        Ok(t.clone())
    }

    #[napi]
    pub fn get_scrollback(&self) -> Result<NapiScrollback> {
        let parser = self.parser.lock().map_err(|e| {
            Error::from_reason(format!("Failed to lock parser: {}", e))
        })?;
        let screen = parser.screen();
        let scrollback_len = screen.scrollback() as u32;

        Ok(NapiScrollback {
            viewport_offset: 0, // Headless mode, no viewport scroll state
            total_lines: scrollback_len + self.rows as u32,
            screen_lines: self.rows as u32,
        })
    }

    #[napi]
    pub fn scroll_viewport(&self, _delta: i32) -> Result<()> {
        // No-op in headless mode — no viewport scroll position to track
        Ok(())
    }
}

// ===============================================================
// Helpers
// ===============================================================

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

fn convert_cell(cell: &vt100::Cell) -> NapiCell {
    let text = cell.contents();

    // Extract foreground color
    let (fg_r, fg_g, fg_b, fg_is_default) = match cell.fgcolor() {
        vt100::Color::Default => (0, 0, 0, true),
        vt100::Color::Rgb(r, g, b) => (r, g, b, false),
        vt100::Color::Idx(idx) => {
            let (r, g, b) = palette_index_to_rgb(idx);
            (r, g, b, false)
        }
    };

    // Extract background color
    let (bg_r, bg_g, bg_b, bg_is_default) = match cell.bgcolor() {
        vt100::Color::Default => (0, 0, 0, true),
        vt100::Color::Rgb(r, g, b) => (r, g, b, false),
        vt100::Color::Idx(idx) => {
            let (r, g, b) = palette_index_to_rgb(idx);
            (r, g, b, false)
        }
    };

    // Underline style — the vt100 crate only has on/off
    let underline = if cell.underline() { "single" } else { "none" };

    NapiCell {
        text: text.to_string(),
        fg_r,
        fg_g,
        fg_b,
        fg_is_default,
        bg_r,
        bg_g,
        bg_b,
        bg_is_default,
        bold: cell.bold(),
        faint: cell.faint(),
        italic: cell.italic(),
        underline: underline.to_string(),
        strikethrough: false, // vt100 crate doesn't expose strikethrough
        inverse: cell.inverse(),
        wide: false, // vt100 crate doesn't expose width directly; would need heuristic
    }
}
