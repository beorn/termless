import { describe, test, expect } from "vitest"
import { createVt220Backend } from "../src/backend.ts"

describe("createVt220Backend", () => {
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

  // ── 8 standard colors ──

  test("feed ANSI color codes, getCell() has correct fg color", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[31mR\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("R")
    expect(cell.fg).not.toBeNull()
    expect(cell.fg!.r).toBe(0x80)
    backend.destroy()
  })

  test("feed text with background color, getCell() has correct bg", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[42mG\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.bg).not.toBeNull()
    expect(cell.bg!.g).toBe(0x80)
    backend.destroy()
  })

  // ── Hidden/conceal ──

  test("hidden attribute (SGR 8/28)", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[8mH\x1b[28mV"))
    expect(backend.getCell(0, 0).hidden).toBe(true)
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
