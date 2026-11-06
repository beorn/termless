import type {
  OscMetadataExtension,
  PasteEncodingExtension,
  AdapterSourcesExtension,
} from "../../../src/terminal/types.ts"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { hasExtension } from "../../../src/terminal/types.ts"
import { describe, test, expect } from "vitest"
import { createVt220Backend } from "../src/backend.ts"

describe("createVt220Backend", () => {
  // @failure The extension binds another Screen, invents payload readers, or hides lifecycle errors with an empty report.
  // @level l0 @consumer Terminfo's public unhandled-sequence reader.
  test("forwards same-instance ignored reports with normal lifecycle and reply behavior", () => {
    const backend = createVt220Backend()
    expect(hasExtension<OscMetadataExtension>(backend, "osc-metadata")).toBe(true)
    if (!hasExtension<OscMetadataExtension>(backend, "osc-metadata") || !backend.getUnhandledSequences) {
      throw new Error("missing native ignored-sequence reader")
    }
    const read = backend.getUnhandledSequences
    expect(() => read()).toThrow(/not initialized/)
    backend.init({ cols: 12, rows: 3 })
    const replies: string[] = []
    backend.onResponse = (bytes) => replies.push(new TextDecoder().decode(bytes))
    const feed = (text: string) => backend.feed(new TextEncoder().encode(text))
    try {
      expect(read()).toEqual([])
      expect(backend.getCwd).toBeUndefined()
      expect(backend.getNotifications).toBeUndefined()
      feed("\x1b[1mA")
      expect(backend.getCell(0, 0).bold).toBe(true)
      expect(read()).toEqual([])
      feed("\x1b[3m\x1b]777;private payload\x07\x1b[5n")
      expect(read()).toEqual([
        { kind: "csi", code: "3m" },
        { kind: "osc", code: "777" },
      ])
      expect(replies).toEqual(["\x1b[0n"])
      backend.reset()
      expect(read()).toEqual([])
      feed("\x1b[3m")
      expect(read()).toEqual([{ kind: "csi", code: "3m" }])
      backend.init({ cols: 12, rows: 3 })
      expect(read()).toEqual([])
    } finally {
      backend.destroy()
    }
    expect(() => read()).toThrow(/not initialized/)
  })

  // R2: unknown SGR operands must not swallow adjacent genuine DEC operands.
  test("applies documented SGR operands independently and ignores colon operands whole", () => {
    const backend = createVt220Backend({ cols: 12, rows: 3 })
    try {
      backend.feed(new TextEncoder().encode("\x1b[38;2;1;4;5mA\x1b[0m\x1b[38:2:1:4:5mB"))
      expect(backend.getCell(0, 0)).toMatchObject({
        bold: true,
        underline: "single",
        blink: true,
        fg: null,
        bg: null,
      })
      expect(backend.getCell(0, 1)).toMatchObject({
        bold: false,
        underline: false,
        blink: false,
        fg: null,
        bg: null,
      })
    } finally {
      backend.destroy()
    }
  })

  // R1: unsupported XTWINOPS must be silent while genuine DEC reports still recover.
  test("ignores CSI 18t and preserves following DSR and CPR replies", () => {
    const backend = createVt220Backend({ cols: 12, rows: 3 })
    const replies: string[] = []
    backend.onResponse = (bytes) => replies.push(new TextDecoder().decode(bytes))
    try {
      backend.feed(new TextEncoder().encode("\x1b[18t"))
      expect(replies).toEqual([])
      backend.feed(new TextEncoder().encode("\x1b[2;3H\x1b[5n\x1b[6n"))
      expect(replies.join("")).toBe("\x1b[0n\x1b[2;3R")
    } finally {
      backend.destroy()
    }
  })

  // @failure Native paste must use this adapter instance without leaking bytes to responses.
  // @level l0
  // @consumer Library-native paste probes through PasteEncodingExtension.
  test("forwards same-instance native paste and preserves response delivery", () => {
    const backend = createVt220Backend({ cols: 12, rows: 3 })
    const replies: string[] = []
    backend.onResponse = (bytes) => replies.push(new TextDecoder().decode(bytes))
    try {
      expect(hasExtension(backend, "paste-encoding")).toBe(true)
      if (!hasExtension<PasteEncodingExtension>(backend, "paste-encoding")) {
        throw new Error("missing native paste encoder")
      }
      const feed = (text: string) => backend.feed(new TextEncoder().encode(text))
      feed("seed\x1b[5n")
      expect(replies.join("")).toBe("\x1b[0n")
      const before = { text: backend.getText(), cursor: backend.getCursor(), scrollback: backend.getScrollback() }
      for (const enabled of [false, true, false]) {
        feed(enabled ? "\x1b[?2004h" : "\x1b[?2004l")
        expect(backend.getMode("bracketedPaste")).toBe(enabled && false)
        const text = "é中😀\r\n"
        const expected = enabled && false ? "\x1b[200~" + text + "\x1b[201~" : text
        expect(backend.encodePaste(text)).toEqual(new TextEncoder().encode(expected))
      }
      expect(replies.join("")).toBe("\x1b[0n")
      expect({ text: backend.getText(), cursor: backend.getCursor(), scrollback: backend.getScrollback() }).toEqual(
        before,
      )
      feed("\x1b[5n")
      expect(replies.join("")).toBe("\x1b[0n\x1b[0n")
    } finally {
      backend.destroy()
    }
  })

  test("native paste follows the existing init, destroy and re-init lifecycle", () => {
    const backend = createVt220Backend()
    expect(hasExtension(backend, "paste-encoding")).toBe(true)
    if (!hasExtension<PasteEncodingExtension>(backend, "paste-encoding")) {
      throw new Error("missing native paste encoder")
    }
    expect(() => backend.encodePaste("x")).toThrow(/not initialized/)
    backend.init({ cols: 12, rows: 3 })
    expect(backend.encodePaste("x")).toEqual(new TextEncoder().encode("x"))
    backend.destroy()
    expect(() => backend.encodePaste("x")).toThrow(/not initialized/)
    backend.init({ cols: 12, rows: 3 })
    try {
      expect(backend.encodePaste("")).toEqual(new Uint8Array())
    } finally {
      backend.destroy()
    }
  })

  // Adapter-byte pins remain mandatory with source and packed/registry engines.
  test("exposes actual imported adapter source bytes", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    try {
      expect(hasExtension(backend, "adapter-sources")).toBe(true)
      if (!hasExtension<AdapterSourcesExtension>(backend, "adapter-sources")) {
        throw new Error("initialized backend exposes no adapter sources")
      }
      const sources = backend.getAdapterSources()
      const repo = fileURLToPath(new URL("../../../", import.meta.url))
      // Resolve the actual entry and implementation imports independently of declaration paths.
      const importedSources = [import.meta.resolve("../src/index.ts"), import.meta.resolve("../src/backend.ts")]
      expect(sources).toEqual(
        importedSources.map((url) => {
          const target = realpathSync(fileURLToPath(url))
          const bytes = readFileSync(target)
          const blobOid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
          return { path: relative(repo, target).replaceAll("\\", "/"), blobOid }
        }),
      )
    } finally {
      backend.destroy()
    }
  })

  // ── Lifecycle ──

  test("creates backend with default options (80x24)", () => {
    const backend = createVt220Backend()
    backend.init({ cols: 80, rows: 24 })
    const cursor = backend.getCursor()
    expect(cursor.x).toBe(0)
    expect(cursor.y).toBe(0)
    backend.destroy()
  })

  test("can be eagerly initialized via opts", () => {
    const backend = createVt220Backend({ cols: 60, rows: 20 })
    expect(backend.getText()).toBeDefined()
    backend.destroy()
  })

  test("throws if not initialized", () => {
    const backend = createVt220Backend()
    expect(() => backend.getText()).toThrow("not initialized")
    backend.destroy()
  })

  // ── Text I/O ──

  test("feed plain text, getText() returns it", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("hello world"))
    expect(backend.getText()).toContain("hello world")
    backend.destroy()
  })

  // ── Monochrome SGR ──

  test("ignores unsupported ANSI foreground color", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[31mR\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("R")
    expect(cell.fg).toBeNull()
    backend.destroy()
  })

  test("ignores unsupported ANSI background color", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[42mG\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.bg).toBeNull()
    backend.destroy()
  })

  // ── Hidden/conceal ──

  test("ignores unsupported conceal operands (SGR 8/28)", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[8mH\x1b[28mV"))
    expect(backend.getCell(0, 0).hidden).toBe(false)
    expect(backend.getCell(0, 1).hidden).toBe(false)
    backend.destroy()
  })

  // ── Insert mode ──

  test("insert mode (IRM)", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    expect(backend.getMode("insertMode")).toBe(false)
    backend.feed(new TextEncoder().encode("\x1b[4h"))
    expect(backend.getMode("insertMode")).toBe(true)
    backend.feed(new TextEncoder().encode("\x1b[4l"))
    expect(backend.getMode("insertMode")).toBe(false)
    backend.destroy()
  })

  // ── Capabilities ──

  test("capabilities reflect VT220", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    expect(backend.capabilities.name).toBe("vt220")
    expect(backend.capabilities.truecolor).toBe(false)
    backend.destroy()
  })

  test("backend name is vt220", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    expect(backend.name).toBe("vt220")
    backend.destroy()
  })
})

// Classic engine cells do not report these attributes; SGR cannot turn absence into false.
test("VT220 returns null for unreported styles in measured and out-of-range cells", () => {
  const backend = createVt220Backend({ cols: 2, rows: 1 })
  try {
    backend.feed(new TextEncoder().encode("\x1b[2;3;9mX"))
    for (const cell of [backend.getCell(0, 0), backend.getCell(9, 9)]) {
      expect(cell).toMatchObject({ dim: null, italic: null, strikethrough: null })
    }
  } finally {
    backend.destroy()
  }
})
