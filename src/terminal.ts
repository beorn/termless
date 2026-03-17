/**
 * Terminal — high-level API wrapping a TerminalBackend + optional PTY.
 *
 * Provides the main createTerminal() factory that composes a backend with
 * optional process spawning, key input, text search, and screenshot capabilities.
 */

import type {
  Cell,
  CellView,
  CursorState,
  PngScreenshotOptions,
  RegionView,
  RowView,
  ScrollbackState,
  SvgScreenshotOptions,
  Terminal,
  TerminalBackend,
  TerminalCreateOptions,
  TerminalMode,
  TextPosition,
  MouseOptions,
  MouseModifiers,
} from "./types.ts"
import { parseKey, keyToAnsi } from "./key-mapping.ts"
import { spawnPty, type PtyHandle } from "./pty.ts"
import { screenshotSvg } from "./svg.ts"
import { screenshotPng } from "./png.ts"
import {
  createBufferView,
  createCellView,
  createRangeView,
  createRowView,
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
export function createTerminal(options: TerminalCreateOptions): Terminal {
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

  // ── TerminalReadable delegation ──

  function getText(): string {
    return backend.getText()
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    return backend.getTextRange(startRow, startCol, endRow, endCol)
  }

  function getCell(row: number, col: number): Cell {
    return backend.getCell(row, col)
  }

  function getLine(row: number): Cell[] {
    return backend.getLine(row)
  }

  function getLines(): Cell[][] {
    return backend.getLines()
  }

  function getCursor(): CursorState {
    return backend.getCursor()
  }

  function getMode(mode: TerminalMode): boolean {
    return backend.getMode(mode)
  }

  function getTitle(): string {
    return backend.getTitle()
  }

  function getScrollback(): ScrollbackState {
    return backend.getScrollback()
  }

  // ── Data feed ──

  function feed(data: Uint8Array | string): void {
    if (closed) throw new Error("Terminal is closed")
    const text = typeof data === "string" ? data : new TextDecoder().decode(data)
    scanOsc52(text)
    const bytes = typeof data === "string" ? encoder.encode(data) : data
    backend.feed(bytes)
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
        scanOsc52(new TextDecoder().decode(data))
        backend.feed(data)
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
    let btn = options?.button ?? 0
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

  function find(text: string): TextPosition | null {
    const content = getText()
    const lines = content.split("\n")
    for (let row = 0; row < lines.length; row++) {
      const col = lines[row]!.indexOf(text)
      if (col !== -1) {
        return { row, col, text }
      }
    }
    return null
  }

  function findAll(pattern: RegExp): TextPosition[] {
    const content = getText()
    const lines = content.split("\n")
    const results: TextPosition[] = []

    for (let row = 0; row < lines.length; row++) {
      const line = lines[row]!
      // Use a new regex per line to reset lastIndex for global patterns
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)
      let match: RegExpExecArray | null
      while ((match = re.exec(line)) !== null) {
        results.push({ row, col: match.index, text: match[0] })
        // Prevent infinite loop on zero-length matches
        if (match[0].length === 0) re.lastIndex++
      }
    }

    return results
  }

  // ── Screenshot ──

  function screenshot(svgOptions?: SvgScreenshotOptions): string {
    return screenshotSvg(terminal, svgOptions)
  }

  function screenshotAsPng(pngOptions?: PngScreenshotOptions): Promise<Uint8Array> {
    return screenshotPng(terminal, pngOptions)
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

  const terminal: Terminal = {
    get cols() {
      return cols
    },
    get rows() {
      return rows
    },
    get backend() {
      return backend
    },

    // TerminalReadable
    getText,
    getTextRange,
    getCell,
    getLine,
    getLines,
    getCursor,
    getMode,
    getTitle,
    getScrollback,

    // Region selectors
    get screen(): RegionView {
      return createScreenView(backend)
    },
    get scrollback(): RegionView {
      return createScrollbackView(backend)
    },
    get buffer(): RegionView {
      return createBufferView(backend)
    },
    get viewport(): RegionView {
      return createViewportView(backend)
    },
    row(n: number): RowView {
      const { totalLines, screenLines } = backend.getScrollback()
      const base = totalLines - screenLines
      const screenRow = n >= 0 ? n : screenLines + n
      return createRowView(backend, base + screenRow, screenRow)
    },
    cell(r: number, c: number): CellView {
      const { totalLines, screenLines } = backend.getScrollback()
      const base = totalLines - screenLines
      const screenRow = r >= 0 ? r : screenLines + r
      return createCellView(backend.getCell(base + screenRow, c), screenRow, c)
    },
    range(r1: number, c1: number, r2: number, c2: number): RegionView {
      return createRangeView(backend, r1, c1, r2, c2)
    },
    firstRow(): RowView {
      return this.row(0)
    },
    lastRow(): RowView {
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
    find,
    findAll,

    // Screenshot
    screenshotSvg: screenshot,
    screenshotPng: screenshotAsPng,

    // Resize
    resize,

    // Cleanup
    close,
    [Symbol.asyncDispose]: close,
  }

  return terminal
}
