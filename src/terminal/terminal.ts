/**
 * Terminal — high-level API wrapping a TerminalBackend + optional PTY.
 *
 * Provides the main createTerminal() factory that composes a backend with
 * optional process spawning, key input, text search, and screenshot capabilities.
 */

import type {
  Cell,
  Cursor,
  PngScreenshotOptions,
  Region,
  Row,
  ScreenshotOptions,
  ScrollbackState,
  SvgScreenshotOptions,
  TestTerminal,
  TerminalBackend,
  TerminalCreateOptions,
  TerminalMode,
  TextMatch,
  MouseOptions,
  MouseModifiers,
  RawOutput,
} from "./types.ts"
import { parseKey, keyToAnsi } from "./key-mapping.ts"
import { spawnPty, type PtyHandle } from "./pty.ts"
import { screenshotSvg } from "../render/svg.ts"
import { screenshotPng } from "../render/png.ts"
import {
  createBufferView,
  createCellView,
  createRangeView,
  createRow,
  createScreenView,
  createScrollbackView,
  createViewportView,
} from "./views.ts"

// ── Constants ──

const POLL_INTERVAL = 50
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const DEFAULT_WAIT_TIMEOUT = 5000
const DEFAULT_STABLE_MS = 200

// ── Text encoder (shared) ──

const encoder = new TextEncoder()

// ── Factory ──

/**
 * Create a Terminal instance wrapping a backend with optional PTY support.
 *
 * The terminal initializes the backend immediately and provides methods for:
 * - Feeding data directly (no PTY)
 * - Spawning a child process with a PTY
 * - Sending key presses and typed text to the PTY
 * - Waiting for terminal content to appear or stabilize
 * - Searching terminal text
 * - Taking SVG and PNG screenshots
 */
export function createTerminal(options: TerminalCreateOptions): TestTerminal {
  const { backend, scrollbackLimit } = options
  let cols = options.cols ?? DEFAULT_COLS
  let rows = options.rows ?? DEFAULT_ROWS

  // Initialize the backend
  backend.init({ cols, rows, scrollbackLimit })

  let ptyHandle: PtyHandle | null = null
  let closed = false

  // ── OSC 52 clipboard capture ──

  /** OSC 52 regex: \x1b]52;c;<base64>\x07 or \x1b]52;c;<base64>\x1b\\ */
  const osc52Re = /\x1b\]52;[a-z]*;([A-Za-z0-9+/=]+)(?:\x07|\x1b\\)/g

  const clipboardWrites: string[] = []
  const outputChunks: string[] = []
  let outputDecoder = new TextDecoder()

  const out: RawOutput = {
    getText() {
      return outputChunks.join("")
    },
    getChunks() {
      return [...outputChunks]
    },
    containsOutput(text: string) {
      return this.getText().includes(text)
    },
    clear() {
      outputChunks.length = 0
      outputDecoder = new TextDecoder()
    },
  }

  function captureOutput(data: string): void {
    if (data.length > 0) outputChunks.push(data)
  }

  function scanOsc52(data: string): void {
    osc52Re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = osc52Re.exec(data)) !== null) {
      try {
        const decoded = atob(match[1]!)
        clipboardWrites.push(decoded)
      } catch {
        // Ignore invalid base64
      }
    }
  }

  // ── Terminal read-contract delegation ──

  function getText(): string {
    return backend.getText()
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    return backend.getTextRange(startRow, startCol, endRow, endCol)
  }

  function getCell(row: number, col: number): Cell {
    return backend.getCell(row, col)
  }

  function getRow(row: number): Cell[] {
    return backend.getRow(row)
  }

  function getRows(): Cell[][] {
    return backend.getRows()
  }

  /** @deprecated Renamed to {@link getRow}. */
  function getLine(row: number): Cell[] {
    return backend.getRow(row)
  }

  /** @deprecated Renamed to {@link getRows}. */
  function getLines(): Cell[][] {
    return backend.getRows()
  }

  /**
   * Normalize a backend cursor so both the canonical `col`/`row` and the
   * deprecated `x`/`y` mirrors are always populated, regardless of which a
   * given backend supplied.
   */
  function getCursor(): Cursor {
    const c = backend.getCursor()
    const col = c.col ?? c.x ?? 0
    const row = c.row ?? c.y ?? 0
    return { ...c, col, row, x: col, y: row }
  }

  function getMode(mode: TerminalMode): boolean {
    return backend.getMode(mode)
  }

  function getTitle(): string {
    return backend.getTitle()
  }

  /**
   * Normalize a backend scrollback state so both the canonical
   * `viewportTop`/`totalRows`/`screenRows` and the deprecated
   * `viewportOffset`/`totalLines`/`screenLines` mirrors are always populated.
   */
  function getScrollback(): ScrollbackState {
    const s = backend.getScrollback()
    const viewportTop = s.viewportTop ?? s.viewportOffset ?? 0
    const totalRows = s.totalRows ?? s.totalLines ?? 0
    const screenRows = s.screenRows ?? s.screenLines ?? 0
    return {
      ...s,
      viewportTop,
      totalRows,
      screenRows,
      viewportOffset: viewportTop,
      totalLines: totalRows,
      screenLines: screenRows,
    }
  }

  // ── Data feed ──

  function feed(data: Uint8Array | string): void {
    if (closed) throw new Error("Terminal is closed")
    const text = typeof data === "string" ? data : outputDecoder.decode(data, { stream: true })
    captureOutput(text)
    scanOsc52(text)
    const bytes = typeof data === "string" ? encoder.encode(data) : data
    backend.feed(bytes)
    options.onAfterWrite?.(bytes)
  }

  // ── PTY lifecycle ──

  async function spawn(command: string[], spawnOpts?: { env?: Record<string, string>; cwd?: string }): Promise<void> {
    if (closed) throw new Error("Terminal is closed")
    if (ptyHandle) throw new Error("Terminal already has a spawned process")

    ptyHandle = spawnPty({
      command,
      env: spawnOpts?.env,
      cwd: spawnOpts?.cwd,
      cols,
      rows,
      onData: (data) => {
        const text = outputDecoder.decode(data, { stream: true })
        captureOutput(text)
        scanOsc52(text)
        backend.feed(data)
        options.onAfterWrite?.(data)
      },
    })

    // Wire emulator→PTY response path (e.g., cursor position reports, DA responses)
    backend.onResponse = (data) => {
      if (ptyHandle?.alive) {
        ptyHandle.write(new TextDecoder().decode(data))
      }
    }
  }

  // ── Input ──

  function press(key: string): void {
    if (closed) throw new Error("Terminal is closed")
    if (!ptyHandle) throw new Error("No PTY spawned — call spawn() first")

    const desc = parseKey(key)
    const encoded = backend.encodeKey(desc)

    // encodeKey returns backend-specific encoding; fall back to ANSI if empty
    if (encoded.length > 0) {
      ptyHandle.write(new TextDecoder().decode(encoded))
    } else {
      const ansi = keyToAnsi(desc)
      if (ansi) ptyHandle.write(ansi)
    }
  }

  function type(text: string): void {
    if (closed) throw new Error("Terminal is closed")
    if (!ptyHandle) throw new Error("No PTY spawned — call spawn() first")
    ptyHandle.write(text)
  }

  // ── Mouse (SGR mode 1006) ──

  /** Encode SGR button byte: button number + modifier bits. */
  function sgrButton(options?: MouseOptions): number {
    const raw = options?.button ?? "left"
    // Normalize the deprecated numeric spellings (0/1/2) and the canonical
    // string spellings ("left"/"middle"/"right") to the SGR button number.
    let btn = typeof raw === "number" ? raw : raw === "left" ? 0 : raw === "middle" ? 1 : 2
    if (options?.shift) btn += 4
    if (options?.alt) btn += 8
    if (options?.ctrl) btn += 16
    return btn
  }

  function requirePty(): PtyHandle {
    if (closed) throw new Error("Terminal is closed")
    if (!ptyHandle) throw new Error("No PTY spawned — call spawn() first")
    return ptyHandle
  }

  function click(x: number, y: number, options?: MouseOptions): void {
    const pty = requirePty()
    const col = x + 1
    const row = y + 1
    const btn = sgrButton(options)
    pty.write(`\x1b[<${btn};${col};${row}M`) // press
    pty.write(`\x1b[<${btn};${col};${row}m`) // release
  }

  async function dblclick(x: number, y: number, options?: MouseOptions & { delay?: number }): Promise<void> {
    const delay = options?.delay ?? 50
    click(x, y, options)
    await new Promise((r) => setTimeout(r, delay))
    click(x, y, options)
  }

  function mouseDown(x: number, y: number, options?: MouseOptions): void {
    const pty = requirePty()
    const btn = sgrButton(options)
    pty.write(`\x1b[<${btn};${x + 1};${y + 1}M`)
  }

  function mouseUp(x: number, y: number, options?: MouseOptions): void {
    const pty = requirePty()
    const btn = sgrButton(options)
    pty.write(`\x1b[<${btn};${x + 1};${y + 1}m`)
  }

  function mouseMove(x: number, y: number, options?: MouseOptions): void {
    const pty = requirePty()
    // SGR motion: button 32 + modifier bits (drag with no button = just move)
    const btn = 32 + sgrButton(options)
    pty.write(`\x1b[<${btn};${x + 1};${y + 1}M`)
  }

  function wheel(deltaX: number, deltaY: number, options?: { x?: number; y?: number } & MouseModifiers): void {
    const pty = requirePty()
    const col = (options?.x ?? 0) + 1
    const row = (options?.y ?? 0) + 1
    let mods = 0
    if (options?.shift) mods += 4
    if (options?.alt) mods += 8
    if (options?.ctrl) mods += 16
    // SGR wheel: button 64=up, 65=down. Horizontal: future extension.
    if (deltaY < 0) {
      for (let i = 0; i < Math.abs(deltaY); i++) pty.write(`\x1b[<${64 + mods};${col};${row}M`)
    } else if (deltaY > 0) {
      for (let i = 0; i < deltaY; i++) pty.write(`\x1b[<${65 + mods};${col};${row}M`)
    }
  }

  // ── Waiting ──

  /** @deprecated Use `await expect(term.screen).toContainText("text", { timeout })` instead. */
  async function waitFor(text: string, timeout = DEFAULT_WAIT_TIMEOUT): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (getText().includes(text)) return
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
    }
    throw new Error(`Timeout waiting for "${text}" after ${timeout}ms`)
  }

  async function waitForStable(stableMs = DEFAULT_STABLE_MS, timeout = DEFAULT_WAIT_TIMEOUT): Promise<void> {
    const start = Date.now()
    let lastContent = ""
    let stableStart = Date.now()

    while (Date.now() - start < timeout) {
      const content = getText()
      if (content === lastContent) {
        if (Date.now() - stableStart >= stableMs) return
      } else {
        lastContent = content
        stableStart = Date.now()
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
    }
    throw new Error(`Terminal did not stabilize within ${timeout}ms`)
  }

  // ── Search ──

  /** Collect the underlying cells for a match at an absolute buffer row/col. */
  function matchCells(row: number, col: number, text: string): Cell[] {
    const cells: Cell[] = []
    for (let i = 0; i < text.length; i++) {
      cells.push(backend.getCell(row, col + i))
    }
    return cells
  }

  function findText(text: string): TextMatch | null {
    const content = getText()
    const lines = content.split("\n")
    for (let row = 0; row < lines.length; row++) {
      const col = lines[row]!.indexOf(text)
      if (col !== -1) {
        return { row, col, text, cells: matchCells(row, col, text) }
      }
    }
    return null
  }

  function findAllText(pattern: RegExp): TextMatch[] {
    const content = getText()
    const lines = content.split("\n")
    const results: TextMatch[] = []

    for (let row = 0; row < lines.length; row++) {
      const line = lines[row]!
      // Use a new regex per line to reset lastIndex for global patterns
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)
      let match: RegExpExecArray | null
      while ((match = re.exec(line)) !== null) {
        results.push({ row, col: match.index, text: match[0], cells: matchCells(row, match.index, match[0]) })
        // Prevent infinite loop on zero-length matches
        if (match[0].length === 0) re.lastIndex++
      }
    }

    return results
  }

  /** @deprecated Renamed to {@link findText}. */
  function find(text: string): TextMatch | null {
    return findText(text)
  }

  /** @deprecated Renamed to {@link findAllText}. */
  function findAll(pattern: RegExp): TextMatch[] {
    return findAllText(pattern)
  }

  // ── Screenshot ──

  function screenshot(svgOptions?: SvgScreenshotOptions): string {
    return screenshotSvg(terminal, svgOptions)
  }

  function screenshotAsPng(pngOptions?: PngScreenshotOptions): Promise<Uint8Array> {
    return screenshotPng(terminal, pngOptions)
  }

  function screenshotOptionsToPng(opts?: ScreenshotOptions): PngScreenshotOptions | undefined {
    if (!opts) return undefined
    return { ...opts, scale: opts.dpr ?? 2 } as PngScreenshotOptions
  }

  /**
   * Auto-picking screenshot — see Terminal.screenshot in types.ts for the
   * decision tree.
   *
   * `opts.renderer` is a *force* override:
   *  - `canvas` — always the native-canvas path (`screenshotCanvasPng`).
   *  - `resvg`  — always the resvg SVG → PNG path (`screenshotPng`).
   *  - `auto` / unset — the decision tree below:
   *    1. Backend has its own raster renderer (ghostty) — use it directly.
   *    2. `@termless/ghostty` is installed — proxy via cellsToAnsi + renderAnsiPng.
   *    3. Fall back to resvg-based SVG → PNG (cross-platform safe; lower fidelity).
   */
  async function screenshotAuto(opts?: ScreenshotOptions): Promise<Uint8Array> {
    // Forced renderer — bypass the decision tree.
    if (opts?.renderer === "canvas") return screenshotAsCanvasPng(opts)
    if (opts?.renderer === "resvg") return screenshotPng(terminal, screenshotOptionsToPng(opts))
    if (opts?.renderer === "swash") return screenshotAsSwashPng(opts)
    if (opts?.renderer === "browser") return screenshotAsBrowserPng(opts)

    // 1. Backend's own renderer.
    if (backend.screenshot) {
      return backend.screenshot(opts)
    }

    // 2. Try the @termless/ghostty proxy path.
    try {
      const ghosttyMod = (await import("@termless/ghostty")) as {
        renderAnsiPng: (ansi: string | Uint8Array, opts?: unknown) => Promise<Uint8Array>
        cellsToAnsi: (term: TerminalBackend, opts?: { cols?: number; rows?: number }) => string
      }
      const ansi = ghosttyMod.cellsToAnsi(backend, {
        cols: opts?.cols ?? cols,
        rows: opts?.rows ?? rows,
      })
      return ghosttyMod.renderAnsiPng(ansi, { cols, rows, ...opts })
    } catch (err) {
      if (
        err instanceof Error &&
        /Cannot find (module|package)|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/.test(err.message)
      ) {
        // 3. resvg fallback.
        return screenshotPng(terminal, screenshotOptionsToPng(opts))
      }
      throw err
    }
  }

  /**
   * Explicit swash path — rasterizes the cell grid directly via
   * `@termless/swash-render` (pure-Rust swash). The cells path is swash's
   * fidelity edge: color-emoji glyphs composite their native color bitmaps,
   * which the SVG-flattening canvas / resvg paths lose. Fails loudly if the
   * native binding is not built.
   */
  async function screenshotAsSwashPng(opts?: ScreenshotOptions): Promise<Uint8Array> {
    const { selectRasterizer } = await import("../view/rasterizer.ts")
    const rasterizer = await selectRasterizer("swash")
    if (!rasterizer.cellsToPng) {
      throw new Error("swash renderer did not expose a cells path")
    }
    const scale = opts?.dpr ?? 2
    return rasterizer.cellsToPng(terminal, scale)
  }

  /**
   * Explicit browser path — rasterizes the SVG via headless Chromium
   * (Playwright). The absolute-max-fidelity renderer: a real browser text
   * engine gives Chrome-identical shaping, font fallback, ligatures, and
   * color emoji. Opt-in only — Playwright is an optional dependency, and
   * `selectRasterizer("browser")` throws a clear install hint if absent.
   */
  async function screenshotAsBrowserPng(opts?: ScreenshotOptions): Promise<Uint8Array> {
    const { selectRasterizer } = await import("../view/rasterizer.ts")
    const rasterizer = await selectRasterizer("browser")
    const scale = opts?.dpr ?? 2
    // The browser renderer needs a self-contained SVG — embed the bundled
    // fonts so Chromium renders deterministically, not from host fonts.
    const svgOpts: SvgScreenshotOptions = {
      embedFonts: true,
      ...(opts?.fontFamily ? { fontFamily: opts.fontFamily } : {}),
      ...(opts?.fontSize ? { fontSize: opts.fontSize } : {}),
      ...(opts?.cellWidth ? { cellWidth: opts.cellWidth } : {}),
      ...(opts?.cellHeight ? { cellHeight: opts.cellHeight } : {}),
    }
    const svg = screenshot(svgOpts)
    try {
      return await rasterizer.toPng(svg, scale)
    } finally {
      await rasterizer.dispose?.()
    }
  }

  /**
   * Explicit native-canvas path — always routes through `@termless/ghostty`'s
   * `renderAnsiPng`. Fails loudly if the package is missing.
   */
  async function screenshotAsCanvasPng(opts?: ScreenshotOptions): Promise<Uint8Array> {
    const ghosttyMod = (await import("@termless/ghostty")) as {
      renderAnsiPng: (ansi: string | Uint8Array, opts?: unknown) => Promise<Uint8Array>
      cellsToAnsi: (term: TerminalBackend, opts?: { cols?: number; rows?: number }) => string
    }
    const ansi = ghosttyMod.cellsToAnsi(backend, {
      cols: opts?.cols ?? cols,
      rows: opts?.rows ?? rows,
    })
    return ghosttyMod.renderAnsiPng(ansi, { cols, rows, ...opts })
  }

  // ── Resize ──

  function resize(newCols: number, newRows: number): void {
    if (closed) throw new Error("Terminal is closed")
    cols = newCols
    rows = newRows
    backend.resize(newCols, newRows)
    if (ptyHandle?.alive) {
      ptyHandle.resize(newCols, newRows)
    }
  }

  // ── Cleanup ──

  async function close(): Promise<void> {
    if (closed) return
    closed = true

    // Disconnect emulator→PTY response path
    backend.onResponse = undefined

    if (ptyHandle) {
      await ptyHandle.close()
      ptyHandle = null
    }

    backend.destroy()
  }

  // ── Terminal object ──

  const terminal: TestTerminal = {
    get cols() {
      return cols
    },
    get rows() {
      return rows
    },
    get backend() {
      return backend
    },

    // Terminal read contract
    getText,
    getTextRange,
    getCell,
    getRow,
    getRows,
    getLine,
    getLines,
    getCursor,
    getMode,
    getTitle,
    getScrollback,

    // Region selectors
    get screen(): Region {
      return createScreenView(backend)
    },
    get scrollback(): Region {
      return createScrollbackView(backend)
    },
    get buffer(): Region {
      return createBufferView(backend)
    },
    get viewport(): Region {
      return createViewportView(backend)
    },
    get output(): RawOutput {
      return out
    },
    get out(): RawOutput {
      return out
    },
    row(n: number): Row {
      const s = getScrollback()
      const base = s.totalRows - s.screenRows
      const screenRow = n >= 0 ? n : s.screenRows + n
      return createRow(backend, base + screenRow, screenRow)
    },
    cell(r: number, c: number): Cell {
      const s = getScrollback()
      const base = s.totalRows - s.screenRows
      const screenRow = r >= 0 ? r : s.screenRows + r
      return createCellView(backend.getCell(base + screenRow, c), screenRow, c)
    },
    range(r1: number, c1: number, r2: number, c2: number): Region {
      return createRangeView(backend, r1, c1, r2, c2)
    },
    firstRow(): Row {
      return this.row(0)
    },
    lastRow(): Row {
      return this.row(-1)
    },

    // Data feed
    feed,

    // PTY
    spawn,
    get alive() {
      return ptyHandle?.alive ?? false
    },
    get exitInfo() {
      return ptyHandle?.exitInfo ?? null
    },

    // Input — keyboard
    press,
    type,

    // Clipboard
    clipboardWrites,

    // Input — mouse
    click,
    dblclick,
    mouseDown,
    mouseUp,
    mouseMove,
    wheel,

    // Waiting
    waitFor,
    waitForStable,

    // Search
    findText,
    findAllText,
    find,
    findAll,

    // Screenshot
    screenshotSvg: screenshot,
    screenshotPng: screenshotAsPng,
    screenshot: screenshotAuto,
    screenshotCanvasPng: screenshotAsCanvasPng,

    // Resize
    resize,

    // Cleanup
    close,
    [Symbol.asyncDispose]: close,
  }

  return terminal
}
