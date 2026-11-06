use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::io::Write;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use tattoy_wezterm_surface::{CursorShape, CursorVisibility};
use tattoy_wezterm_term::{
    color::ColorPalette, Alert, AlertHandler, Clipboard, ClipboardSelection, KeyCode, KeyModifiers,
    MouseButton, MouseEvent, MouseEventKind, Progress, Terminal, TerminalConfiguration, TerminalSize,
};

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

    fn enable_kitty_graphics(&self) -> bool {
        true
    }

    fn color_palette(&self) -> ColorPalette {
        ColorPalette::default()
    }
}

// ═══════════════════════════════════════════════════════
// Exported cell type
// ═══════════════════════════════════════════════════════

#[napi(object, use_nullable = true)]
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
    pub ul_r: u8,
    pub ul_g: u8,
    pub ul_b: u8,
    pub ul_is_default: bool,
    pub bold: bool,
    pub faint: bool,
    pub italic: bool,
    pub underline: String,
    pub strikethrough: bool,
    pub inverse: bool,
    pub blink: bool,
    pub overline: bool,
    pub hidden: bool,
    pub wide: bool,
    pub hyperlink: Option<String>,
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

/// One engine-emitted toast (tattoy-wezterm-term 0.1.0-fork.5 Alert::ToastNotification, terminal.rs:49-57), fields
/// verbatim: OSC 9 reports no title (performer.rs:904-911), OSC 777 notify a title only when it carries a body
/// (performer.rs:918-933).
#[napi(object, use_nullable = true)]
#[derive(Clone)]
pub struct NapiToast {
    pub title: Option<String>,
    pub body: String,
}

#[napi(object, use_nullable = true)]
pub struct NapiProgress {
    pub state: u32,
    pub value: Option<u32>,
}

#[derive(Default)]
struct TitleState {
    window: String,
    icon: String,
    /// Every toast the engine emitted since the terminal was created, in order.
    toasts: Vec<NapiToast>,
}

#[derive(Clone, Default)]
struct TitleObserver(Arc<Mutex<TitleState>>);

#[napi(object)]
#[derive(Clone)]
pub struct NapiClipboardWrite {
    pub selector: String,
    pub text: String,
}

#[derive(Clone, Default)]
struct ClipboardObserver(Arc<Mutex<Vec<NapiClipboardWrite>>>);

impl Clipboard for ClipboardObserver {
    fn set_contents(&self, selection: ClipboardSelection, data: Option<String>) -> anyhow::Result<()> {
        let selector = match selection {
            ClipboardSelection::Clipboard => "c",
            ClipboardSelection::PrimarySelection => "p",
        };
        self.0
            .lock()
            .expect("wezterm clipboard observer mutex poisoned")
            .push(NapiClipboardWrite {
                selector: selector.to_string(),
                // None is the engine's explicit ClearSelection callback.
                text: data.unwrap_or_default(),
            });
        Ok(())
    }
}

impl AlertHandler for TitleObserver {
    fn alert(&mut self, alert: Alert) {
        match alert {
            Alert::WindowTitleChanged(title) => {
                self.0
                    .lock()
                    .expect("wezterm title observer mutex poisoned")
                    .window = title;
            }
            Alert::IconTitleChanged(title) => {
                self.0
                    .lock()
                    .expect("wezterm title observer mutex poisoned")
                    .icon = title.unwrap_or_default();
            }
            Alert::ToastNotification { title, body, .. } => {
                self.0
                    .lock()
                    .expect("wezterm title observer mutex poisoned")
                    .toasts
                    .push(NapiToast { title, body });
            }
            _ => {}
        }
    }
}

#[napi]
pub struct WeztermTerminal {
    term: Terminal,
    writer: SharedWriter,
    barrier_seq: u64,
    cols: usize,
    rows: usize,
    cell_width: usize,
    cell_height: usize,
    titles: TitleObserver,
    clipboard: ClipboardObserver,
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
        let mut term = Terminal::new(
            terminal_size(cols, rows, cell_width, cell_height),
            config,
            "termless-wezterm",
            "0.1.0",
            Box::new(writer.clone()),
        );
        let titles = TitleObserver::default();
        term.set_notification_handler(Box::new(titles.clone()));
        let clipboard = ClipboardObserver::default();
        term.set_clipboard(&(Arc::new(clipboard.clone()) as Arc<dyn Clipboard>));

        WeztermTerminal {
            term,
            writer,
            barrier_seq: 0,
            cols,
            rows,
            cell_width,
            cell_height,
            titles,
            clipboard,
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
        Ok(())
    }

    /// Encode one named key or Unicode scalar using this terminal's current modes.
    /// After a writer-boundary error, this instance must be destroyed: late input
    /// bytes can reach the reply buffer, as with encode_paste. No recovery is promised.
    #[napi]
    pub fn encode_key(
        &mut self,
        key: String,
        shift: bool,
        ctrl: bool,
        alt: bool,
        super_key: bool,
    ) -> Result<Buffer> {
        let unsupported = || {
            Error::from_reason(format!(
                "wezterm keyboard API has no native encoding for {key:?}; expected a shared named key, F1-F24, or one Unicode scalar"
            ))
        };
        // Translate the whole descriptor before entering the writer boundary.
        let native_key = match key.as_str() {
            "ArrowUp" => KeyCode::UpArrow,
            "ArrowDown" => KeyCode::DownArrow,
            "ArrowLeft" => KeyCode::LeftArrow,
            "ArrowRight" => KeyCode::RightArrow,
            "Home" => KeyCode::Home,
            "End" => KeyCode::End,
            "PageUp" => KeyCode::PageUp,
            "PageDown" => KeyCode::PageDown,
            "Enter" => KeyCode::Enter,
            "Tab" => KeyCode::Tab,
            "Backspace" => KeyCode::Backspace,
            "Delete" => KeyCode::Delete,
            "Escape" => KeyCode::Escape,
            "Space" => KeyCode::Char(' '),
            "Control" => KeyCode::Control,
            "Shift" => KeyCode::Shift,
            "Alt" => KeyCode::Alt,
            "Meta" => KeyCode::Meta,
            name if name.starts_with('F') && name.len() > 1 => {
                let number = name[1..].parse::<u8>().map_err(|_| unsupported())?;
                if !(1..=24).contains(&number) || format!("F{number}") != name {
                    return Err(unsupported());
                }
                KeyCode::Function(number)
            }
            _ => {
                let mut scalars = key.chars();
                match (scalars.next(), scalars.next()) {
                    (Some(scalar), None) => KeyCode::Char(scalar),
                    _ => return Err(unsupported()),
                }
            }
        };
        let mut modifiers = KeyModifiers::empty();
        if shift {
            modifiers.insert(KeyModifiers::SHIFT);
        }
        if ctrl {
            modifiers.insert(KeyModifiers::CTRL);
        }
        if alt {
            modifiers.insert(KeyModifiers::ALT);
        }
        if super_key {
            modifiers.insert(KeyModifiers::SUPER);
        }

        self.encode_input(|term| {
            term.key_down(native_key, modifiers)
                .map_err(|err| Error::from_reason(format!("wezterm key encoding failed: {err}")))
        })
    }

    #[napi]
    pub fn encode_paste(&mut self, text: String) -> Result<Buffer> {
        self.encode_input(|term| {
            term.send_paste(&text)
                .map_err(|err| Error::from_reason(format!("wezterm paste encoding failed: {err}")))
        })
    }

    /// Forward one input event; no implicit press or host-side encoding.
    /// Like key and paste, a writer-boundary failure makes this instance unusable.
    #[napi]
    pub fn encode_mouse(
        &mut self,
        x: u32,
        y: i32,
        button: String,
        action: String,
        shift: bool,
        ctrl: bool,
        alt: bool,
        pixel_x: Option<i64>,
        pixel_y: Option<i64>,
    ) -> Result<Buffer> {
        let (x, y, x_pixel_offset, y_pixel_offset) = match (pixel_x, pixel_y) {
            (Some(px), Some(py)) if self.cell_width > 0 && self.cell_height > 0 => (
                px as usize / self.cell_width,
                py / self.cell_height as i64,
                (px % self.cell_width as i64) as isize,
                (py % self.cell_height as i64) as isize,
            ),
            (None, None) => (x as usize, i64::from(y), 0, 0),
            _ => {
                return Err(Error::from_reason(
                    "WezTerm pixel mouse input requires declared pixel geometry",
                ))
            }
        };
        let button = match button.as_str() {
            "left" => MouseButton::Left,
            "middle" => MouseButton::Middle,
            "right" => MouseButton::Right,
            "wheelUp" => MouseButton::WheelUp(1),
            "wheelDown" => MouseButton::WheelDown(1),
            "none" => MouseButton::None,
            _ => {
                return Err(Error::from_reason(format!(
                    "wezterm mouse button is unknown: {button}"
                )))
            }
        };
        let kind = match action.as_str() {
            "press" => MouseEventKind::Press,
            "release" => MouseEventKind::Release,
            "move" => MouseEventKind::Move,
            _ => {
                return Err(Error::from_reason(format!(
                    "wezterm mouse action is unknown: {action}"
                )))
            }
        };
        let mut modifiers = KeyModifiers::empty();
        if shift {
            modifiers.insert(KeyModifiers::SHIFT);
        }
        if ctrl {
            modifiers.insert(KeyModifiers::CTRL);
        }
        if alt {
            modifiers.insert(KeyModifiers::ALT);
        }
        let event = MouseEvent {
            kind,
            x,
            y,
            x_pixel_offset,
            y_pixel_offset,
            button,
            modifiers,
        };
        self.encode_input(|term| {
            term.mouse_event(event)
                .map_err(|err| Error::from_reason(format!("wezterm mouse encoding failed: {err}")))
        })
    }

    fn encode_input(&mut self, encode: impl FnOnce(&mut Terminal) -> Result<()>) -> Result<Buffer> {
        self.sync_responses()?;
        let boundary = {
            let (lock, _) = &*self.writer.inner;
            let state = lock
                .lock()
                .map_err(|_| Error::from_reason("wezterm SharedWriter mutex poisoned"))?;
            state.buf.len()
        };
        encode(&mut self.term)?;
        self.sync_responses()?;
        let (lock, _) = &*self.writer.inner;
        let mut state = lock
            .lock()
            .map_err(|_| Error::from_reason("wezterm SharedWriter mutex poisoned"))?;
        // Only this native input's output belongs to the encoder; queued replies stay in order.
        Ok(state.buf.split_off(boundary).into())
    }

    #[napi]
    pub fn resize(&mut self, cols: u32, rows: u32) {
        self.cols = cols as usize;
        self.rows = rows as usize;
        self.term.resize(terminal_size(
            self.cols,
            self.rows,
            self.cell_width,
            self.cell_height,
        ));
    }

    #[napi]
    pub fn reset(&mut self) -> Result<()> {
        // The backend reset contract clears titles. RIS alone preserves them in
        // WezTerm, so clear both through the engine's real OSC0 notifications.
        self.term.advance_bytes(b"\x1bc\x1b]0;\x07");
        self.sync_responses()?;
        let (lock, _) = &*self.writer.inner;
        let mut state = lock
            .lock()
            .map_err(|_| Error::from_reason("wezterm SharedWriter mutex poisoned"))?;
        state.buf.clear();
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
        let mut parts = Vec::new();

        // Collect lines from the screen using for_each_phys_line
        let mut all_lines: Vec<tattoy_wezterm_term::Line> = Vec::new();
        screen.for_each_phys_line(|_idx, line| {
            all_lines.push(line.clone());
        });

        for row in start_row..=end_row {
            let phys = row;
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
        let phys = row as usize;

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
    pub fn get_cell_semantic_type(&self, row: u32, col: u32) -> napi::Result<String> {
        let screen = self.term.screen();
        if row as usize >= screen.scrollback_rows() || col as usize >= self.cols {
            return Err(napi::Error::from_reason(
                "WezTerm semantic cell coordinates are outside the stored grid",
            ));
        }
        let lines = screen.lines_in_phys_range(row as usize..row as usize + 1);
        let line = lines
            .first()
            .ok_or_else(|| napi::Error::from_reason("WezTerm semantic cell row is missing"))?;
        let cell = line
            .get_cell(col as usize)
            .ok_or_else(|| napi::Error::from_reason("WezTerm semantic cell is missing"))?;
        match format!("{:?}", cell.attrs().semantic_type()).as_str() {
            "Prompt" => Ok("prompt".to_string()),
            "Input" => Ok("input".to_string()),
            "Output" => Ok("output".to_string()),
            other => Err(napi::Error::from_reason(format!(
                "Unknown WezTerm cell semantic type {other}"
            ))),
        }
    }

    #[napi]
    pub fn get_cell_image_count(&self, row: u32, col: u32) -> napi::Result<u32> {
        let screen = self.term.screen();
        if row as usize >= screen.scrollback_rows() || col as usize >= self.cols {
            return Err(napi::Error::from_reason(
                "WezTerm image cell coordinates are outside the stored grid",
            ));
        }
        let lines = screen.lines_in_phys_range(row as usize..row as usize + 1);
        let line = lines
            .first()
            .ok_or_else(|| napi::Error::from_reason("WezTerm image cell row is missing"))?;
        // A valid untouched column is stored sparsely and has no attached images.
        Ok(line
            .get_cell(col as usize)
            .and_then(|cell| cell.attrs().images())
            .map_or(0, |images| images.len() as u32))
    }

    #[napi]
    pub fn get_clipboard_writes(&self) -> Vec<NapiClipboardWrite> {
        self.clipboard
            .0
            .lock()
            .expect("wezterm clipboard observer mutex poisoned")
            .clone()
    }

    #[napi]
    pub fn get_line(&self, row: u32) -> Vec<NapiCell> {
        let screen = self.term.screen();
        let total_lines = screen.scrollback_rows();
        let phys = row as usize;

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
            "applicationCursor" => Some(self.term.application_cursor_keys_enabled()),
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
    pub fn get_title(&self) -> Result<String> {
        let state = self
            .titles
            .0
            .lock()
            .map_err(|_| Error::from_reason("wezterm title observer mutex poisoned"))?;
        Ok(state.window.clone())
    }

    /// A copy of every stored toast, in order.
    #[napi]
    pub fn get_toasts(&self) -> Result<Vec<NapiToast>> {
        let state = self
            .titles
            .0
            .lock()
            .map_err(|_| Error::from_reason("wezterm title observer mutex poisoned"))?;
        Ok(state.toasts.clone())
    }

    /// Serialize the current engine-owned directory without reconstructing its input.
    #[napi]
    pub fn get_cwd(&self) -> Option<String> {
        self.term
            .get_current_dir()
            .map(|url| url.as_str().to_owned())
    }

    /// Project current engine state, without inventing last-report history.
    #[napi]
    pub fn get_progress(&self) -> NapiProgress {
        let (state, value) = match self.term.get_progress() {
            Progress::None => (0, None),
            Progress::Percentage(value) => (1, Some(u32::from(value))),
            Progress::Error(value) => (2, Some(u32::from(value))),
            Progress::Indeterminate => (3, None),
        };
        NapiProgress { state, value }
    }

    #[napi]
    pub fn get_icon_label(&self) -> Result<String> {
        let state = self
            .titles
            .0
            .lock()
            .map_err(|_| Error::from_reason("wezterm title observer mutex poisoned"))?;
        Ok(state.icon.clone())
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
        ul_r: 0,
        ul_g: 0,
        ul_b: 0,
        ul_is_default: true,
        bold: false,
        faint: false,
        italic: false,
        underline: "none".to_string(),
        strikethrough: false,
        inverse: false,
        blink: false,
        overline: false,
        hidden: false,
        wide: false,
        hyperlink: None,
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

    let (ul_r, ul_g, ul_b, ul_is_default) = match attrs.underline_color() {
        tattoy_wezterm_term::color::ColorAttribute::Default => (0, 0, 0, true),
        ul => {
            let (r, g, b) = srgba_rgb(palette.resolve_fg(ul));
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
        ul_r,
        ul_g,
        ul_b,
        ul_is_default,
        bold,
        faint,
        italic: attrs.italic(),
        underline: underline.to_string(),
        strikethrough: attrs.strikethrough(),
        inverse: attrs.reverse(),
        blink: attrs.blink() != tattoy_wezterm_term::Blink::None,
        overline: attrs.overline(),
        hidden: attrs.invisible(),
        wide: cell.width() > 1,
        hyperlink: attrs.hyperlink().map(|link| link.uri().to_owned()),
    }
}
