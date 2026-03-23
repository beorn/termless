/**
 * Tests for the backend registry — manifest loading, enumeration,
 * installation detection, resolution, and install helpers.
 *
 * Note: import.meta.resolve does not resolve workspace packages in vitest's
 * VM context, so tests for isReady/backend() verify the error paths
 * and use direct imports for functional backend tests.
 */

import { describe, test, expect } from "vitest"
import {
  manifest,
  backends,
  backend,
  entry,
  isReady,
  getInstalledVersion,
  createTerminalByName,
} from "../src/backends.ts"
import { createTerminal } from "../src/terminal.ts"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import { createVt100Backend } from "../packages/vt100/src/backend.ts"
import type { TerminalBackend } from "../src/types.ts"

// ═══════════════════════════════════════════════════════
// Manifest tests
// ═══════════════════════════════════════════════════════

describe("manifest", () => {
  test("manifest() returns valid manifest with version and backends", () => {
    const m = manifest()
    expect(m.version).toBeTypeOf("string")
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(m.backends).toBeTypeOf("object")
    expect(Object.keys(m.backends).length).toBeGreaterThan(0)
  })

  test("manifest has all 9 backends", () => {
    const m = manifest()
    const names = Object.keys(m.backends)
    expect(names).toEqual(
      expect.arrayContaining([
        "xtermjs",
        "ghostty",
        "vt100",
        "alacritty",
        "wezterm",
        "peekaboo",
        "vt100-rust",
        "libvterm",
        "kitty",
      ]),
    )
    expect(names).toHaveLength(10)
  })

  test("each backend entry has required fields", () => {
    const m = manifest()
    for (const [name, e] of Object.entries(m.backends)) {
      expect(e.package, `${name}.package`).toBeTypeOf("string")
      expect(e.type, `${name}.type`).toMatch(/^(js|wasm|native|os)$/)
      // upstream can be null for some backends
    }
  })

  test("default backends are xtermjs, ghostty, vt100", () => {
    const m = manifest()
    const defaults = Object.entries(m.backends)
      .filter(([_, e]) => e.default)
      .map(([name]) => name)
      .sort()
    expect(defaults).toEqual(["ghostty", "vt100", "xtermjs"])
  })
})

// ═══════════════════════════════════════════════════════
// Enumeration tests
// ═══════════════════════════════════════════════════════

describe("enumeration", () => {
  test("backends() returns all 9 names", () => {
    const names = backends()
    expect(names).toHaveLength(10)
    expect(names).toContain("xtermjs")
    expect(names).toContain("ghostty")
    expect(names).toContain("vt100")
    expect(names).toContain("alacritty")
    expect(names).toContain("wezterm")
    expect(names).toContain("peekaboo")
    expect(names).toContain("vt100-rust")
    expect(names).toContain("libvterm")
    expect(names).toContain("kitty")
  })

  test("default backends are the 3 with default=true", () => {
    const defaults = backends().filter((n) => entry(n)?.default)
    expect(defaults).toHaveLength(3)
    expect(defaults).toContain("xtermjs")
    expect(defaults).toContain("ghostty")
    expect(defaults).toContain("vt100")
  })

  test("backends().filter(isReady) returns an array of strings", () => {
    // import.meta.resolve may not resolve workspace packages in vitest's VM,
    // so we verify the return type rather than specific contents
    const installed = backends().filter(isReady)
    expect(Array.isArray(installed)).toBe(true)
    for (const name of installed) {
      expect(name).toBeTypeOf("string")
      expect(backends()).toContain(name)
    }
  })
})

// ═══════════════════════════════════════════════════════
// Installation detection tests
// ═══════════════════════════════════════════════════════

describe("installation detection", () => {
  test("isReady('nonexistent') returns false", () => {
    expect(isReady("nonexistent")).toBe(false)
  })

  test("isReady returns boolean for all backends", () => {
    for (const name of backends()) {
      expect(typeof isReady(name)).toBe("boolean")
    }
  })

  test("getInstalledVersion returns null for unknown package", () => {
    const version = getInstalledVersion("@nonexistent/package")
    expect(version).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════
// Resolution tests
// ═══════════════════════════════════════════════════════

describe("resolution", () => {
  test("backend('nonexistent') throws with helpful error listing available backends", async () => {
    await expect(backend("nonexistent")).rejects.toThrow(/Unknown backend "nonexistent"/)
    await expect(backend("nonexistent")).rejects.toThrow(/Available:/)
  })

  test("backend error message lists all backend names", async () => {
    try {
      await backend("nonexistent")
    } catch (e) {
      const msg = (e as Error).message
      // Error should mention available backends for discoverability
      expect(msg).toContain("xtermjs")
      expect(msg).toContain("ghostty")
      expect(msg).toContain("vt100")
    }
  })

  test("directly created xtermjs backend can init, feed, getText, destroy", () => {
    const backend = createXtermBackend()
    backend.init({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("Hello, termless!"))
    const text = backend.getText()
    expect(text).toContain("Hello, termless!")
    backend.destroy()
  })

  test("directly created vt100 backend can init, feed, getText, destroy", () => {
    const backend = createVt100Backend()
    backend.init({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("VT100 test"))
    const text = backend.getText()
    expect(text).toContain("VT100 test")
    backend.destroy()
  })

  test("resolved xtermjs backend has capabilities", () => {
    const backend = createXtermBackend()
    expect(backend.capabilities).toBeDefined()
    expect(backend.capabilities.name).toBeTypeOf("string")
    expect(backend.capabilities.name.length).toBeGreaterThan(0)
    backend.destroy()
  })
})

// ═══════════════════════════════════════════════════════
// createTerminalByName error tests
// ═══════════════════════════════════════════════════════

describe("createTerminalByName", () => {
  test("throws for unknown backend name", async () => {
    await expect(createTerminalByName("nonexistent")).rejects.toThrow(/Unknown backend/)
  })

  test("creates a working terminal using direct backend factory", async () => {
    const backend = createXtermBackend()
    const term = createTerminal({ backend, cols: 80, rows: 24 })
    term.feed("Hello from terminal")
    const text = term.getText()
    expect(text).toContain("Hello from terminal")
    await term.close()
  })
})

// ═══════════════════════════════════════════════════════
// entry() tests
// ═══════════════════════════════════════════════════════

describe("entry", () => {
  test("entry() returns backend entry for known backends", () => {
    const e = entry("xtermjs")
    expect(e).toBeDefined()
    expect(e!.package).toBe("@termless/xtermjs")
    expect(e!.type).toBe("js")
  })

  test("entry() returns undefined for unknown backend", () => {
    expect(entry("nonexistent")).toBeUndefined()
  })

  test("all backends have entries with required fields", () => {
    for (const name of backends()) {
      const e = entry(name)
      expect(e, `${name} should have an entry`).toBeDefined()
      expect(e!.package, `${name}.package`).toBeTypeOf("string")
      expect(e!.type, `${name}.type`).toMatch(/^(js|wasm|native|os)$/)
    }
  })
})
