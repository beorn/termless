use base64::{engine::general_purpose::STANDARD, Engine as _};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::BTreeMap;
use std::sync::Mutex;

#[derive(Default)]
struct TerminalCallbacks {
    title: String,
    icon_label: String,
    clipboard: BTreeMap<String, ClipboardPayload>,
    paste_selector: Option<String>,
}

struct ClipboardPayload {
    payload: String,
    text: Option<String>,
    decode_error: Option<String>,
}

impl vt100::Callbacks for TerminalCallbacks {
    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        self.title = String::from_utf8_lossy(title).into_owned();
    }

    fn set_window_icon_name(&mut self, _: &mut vt100::Screen, icon_name: &[u8]) {
        self.icon_label = String::from_utf8_lossy(icon_name).into_owned();
    }

    fn copy_to_clipboard(&mut self, _: &mut vt100::Screen, selector: &[u8], data: &[u8]) {
        let decoded = STANDARD
            .decode(data)
            .map_err(|error| error.to_string())
            .and_then(|bytes| String::from_utf8(bytes).map_err(|error| error.to_string()));
        let (text, decode_error) = match decoded {
            Ok(text) => (Some(text), None),
            Err(error) => (None, Some(error)),
        };
        // Retain callback arguments exactly; interpreting selector lists is host policy.
        self.clipboard.insert(
            String::from_utf8_lossy(selector).into_owned(),
            ClipboardPayload {
                payload: String::from_utf8_lossy(data).into_owned(),
                text,
                decode_error,
            },
        );
    }

    fn paste_from_clipboard(&mut self, _: &mut vt100::Screen, selector: &[u8]) {
        // vt100 emits a host request, not protocol reply bytes. Do not fabricate a reply.
        self.paste_selector = Some(String::from_utf8_lossy(selector).into_owned());
    }
}

#[napi(object)]
pub struct NapiClipboardWrite {
    pub selector: String,
    pub payload: String,
    pub text: Option<String>,
    pub decode_error: Option<String>,
}

#[napi(object)]
pub struct NapiClipboardState {
    pub writes: Vec<NapiClipboardWrite>,
    pub paste_selector: Option<String>,
}

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
    parser: Mutex<vt100::Parser<TerminalCallbacks>>,
}

#[napi]
impl Vt100RustTerminal {
    #[napi(constructor)]
    pub fn new(cols: u32, rows: u32, scrollback_limit: Option<u32>) -> Self {
        let scrollback = scrollback_limit.unwrap_or(1000) as usize;
        let r = rows as u16;
        let c = cols as u16;

        let parser =
            vt100::Parser::new_with_callbacks(r, c, scrollback, TerminalCallbacks::default());

        Vt100RustTerminal {
            parser: Mutex::new(parser),
        }
    }

    #[napi]
    pub fn feed(&self, data: Buffer) -> Result<()> {
        let mut parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        parser.process(data.as_ref());
        Ok(())
    }

    #[napi]
    pub fn resize(&self, cols: u32, rows: u32) -> Result<()> {
        let mut parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        parser.screen_mut().set_size(rows as u16, cols as u16);
        Ok(())
    }

    #[napi]
    pub fn reset(&self) -> Result<()> {
        let mut parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        // Feed RIS escape sequence to reset
        parser.process(b"\x1bc");
        *parser.callbacks_mut() = TerminalCallbacks::default();
        Ok(())
    }

    #[napi]
    pub fn get_text(&self) -> Result<String> {
        let mut parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        Ok(read_buffer(parser.screen_mut(), |screen, history| {
            let (rows, cols) = screen.size();
            let mut lines = Vec::new();
            for row in 0..history + usize::from(rows) {
                let screen_row = select_buffer_row(screen, history, row);
                let mut line = String::new();
                for col in 0..cols {
                    let contents = screen.cell(screen_row, col).map(|cell| cell.contents());
                    match contents.as_deref() {
                        None | Some("") => line.push(' '),
                        Some(text) => line.push_str(text),
                    }
                }
                lines.push(line.trim_end().to_string());
            }
            lines.join("\n")
        }))
    }

    #[napi]
    pub fn get_text_range(
        &self,
        start_row: i32,
        start_col: i32,
        end_row: i32,
        end_col: i32,
    ) -> Result<String> {
        let mut parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        Ok(read_buffer(parser.screen_mut(), |screen, history| {
            let (rows, cols) = screen.size();
            let total = history + usize::from(rows);
            let mut parts = Vec::new();
            for row in start_row.max(0)..=end_row.min(total as i32 - 1) {
                let screen_row = select_buffer_row(screen, history, row as usize);
                let col_start = if row == start_row {
                    start_col as u16
                } else {
                    0
                };
                let col_end = if row == end_row { end_col as u16 } else { cols };
                let mut text = String::new();
                for col in col_start..col_end.min(cols) {
                    let contents = screen.cell(screen_row, col).map(|cell| cell.contents());
                    match contents.as_deref() {
                        None | Some("") => text.push(' '),
                        Some(contents) => text.push_str(contents),
                    }
                }
                parts.push(text.trim_end().to_string());
            }
            parts.join("\n")
        }))
    }

    #[napi]
    pub fn get_cell(&self, row: i32, col: i32) -> Result<NapiCell> {
        let mut parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        Ok(read_buffer(parser.screen_mut(), |screen, history| {
            let (rows, cols) = screen.size();
            if row < 0
                || row as usize >= history + usize::from(rows)
                || col < 0
                || col >= i32::from(cols)
            {
                return empty_cell();
            }
            let screen_row = select_buffer_row(screen, history, row as usize);
            match screen.cell(screen_row, col as u16) {
                Some(cell) => convert_cell(cell),
                None => empty_cell(),
            }
        }))
    }

    #[napi]
    pub fn get_line(&self, row: i32) -> Result<Vec<NapiCell>> {
        let mut parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        Ok(read_buffer(parser.screen_mut(), |screen, history| {
            let (rows, cols) = screen.size();
            if row < 0 || row as usize >= history + usize::from(rows) {
                return (0..cols).map(|_| empty_cell()).collect();
            }
            let screen_row = select_buffer_row(screen, history, row as usize);
            (0..cols)
                .map(|col| match screen.cell(screen_row, col) {
                    Some(cell) => convert_cell(cell),
                    None => empty_cell(),
                })
                .collect()
        }))
    }

    #[napi]
    pub fn get_cursor(&self) -> Result<NapiCursor> {
        let parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
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
        let parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        let screen = parser.screen();

        Ok(match mode.as_str() {
            "altScreen" => screen.alternate_screen(),
            "cursorVisible" => !screen.hide_cursor(),
            "bracketedPaste" => screen.bracketed_paste(),
            "applicationCursor" => screen.application_cursor(),
            "applicationKeypad" => screen.application_keypad(),
            "mouseTracking" => screen.mouse_protocol_mode() != vt100::MouseProtocolMode::None,
            // Modes not directly exposed by the vt100 crate
            "autoWrap" => true, // Default on, not queryable
            "focusTracking" => false,
            "originMode" => false,
            "insertMode" => false,
            "reverseVideo" => false,
            _ => false,
        })
    }

    #[napi]
    pub fn get_title(&self) -> Result<String> {
        let parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        Ok(parser.callbacks().title.clone())
    }

    #[napi]
    pub fn get_icon_label(&self) -> Result<String> {
        let parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        Ok(parser.callbacks().icon_label.clone())
    }

    #[napi]
    pub fn get_clipboard_state(&self) -> Result<NapiClipboardState> {
        let parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        let callbacks = parser.callbacks();
        Ok(NapiClipboardState {
            writes: callbacks
                .clipboard
                .iter()
                .map(|(selector, value)| NapiClipboardWrite {
                    selector: selector.clone(),
                    payload: value.payload.clone(),
                    text: value.text.clone(),
                    decode_error: value.decode_error.clone(),
                })
                .collect(),
            paste_selector: callbacks.paste_selector.clone(),
        })
    }

    #[napi]
    pub fn get_scrollback(&self) -> Result<NapiScrollback> {
        let mut parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        let offset = parser.screen().scrollback();
        Ok(read_buffer(parser.screen_mut(), |screen, history| {
            let (rows, _) = screen.size();
            NapiScrollback {
                viewport_offset: (history - offset) as i32,
                total_lines: (history + usize::from(rows)) as u32,
                screen_lines: u32::from(rows),
            }
        }))
    }

    #[napi]
    pub fn scroll_viewport(&self, delta: i32) -> Result<()> {
        let mut parser = self
            .parser
            .lock()
            .map_err(|e| Error::from_reason(format!("Failed to lock parser: {}", e)))?;
        let screen = parser.screen_mut();
        // Termless's negative delta means older rows; vt100's offset grows toward history.
        let offset = (screen.scrollback() as i64 - i64::from(delta)).max(0) as usize;
        screen.set_scrollback(offset);
        Ok(())
    }
}

// ===============================================================
// Helpers
// ===============================================================

/// Inspect retained product rows under the parser lock, then restore the caller's view.
fn read_buffer<T>(
    screen: &mut vt100::Screen,
    read: impl FnOnce(&mut vt100::Screen, usize) -> T,
) -> T {
    let offset = screen.scrollback();
    // The public setter clamps to retained occupancy, not configured history capacity.
    screen.set_scrollback(usize::MAX);
    let history = screen.scrollback();
    let result = read(screen, history);
    screen.set_scrollback(offset);
    result
}

/// Select one absolute buffer row using vt100's existing viewport, without copying history.
fn select_buffer_row(screen: &mut vt100::Screen, history: usize, row: usize) -> u16 {
    screen.set_scrollback(history.saturating_sub(row));
    row.saturating_sub(history) as u16
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
        faint: cell.dim(),
        italic: cell.italic(),
        underline: underline.to_string(),
        strikethrough: false, // vt100 crate doesn't expose strikethrough
        inverse: cell.inverse(),
        wide: cell.is_wide(),
    }
}
