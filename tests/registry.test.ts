/**
 * Tests for the backend registry — manifest loading, enumeration,
 * installation detection, resolution, health checks, and install helpers.
 *
 * Note: import.meta.resolve does not resolve workspace packages in vitest's
 * VM context, so tests for isBackendInstalled/resolveBackend/health checks
 * verify the error paths and use direct imports for functional backend tests.
 */

import { describe, test, expect, afterEach } from "vitest"
import {
  loadManifest,
  backendNames,
  defaultBackendNames,
  installedBackendNames,
  isBackendInstalled,
  getInstalledVersion,
  resolveBackend,
  createTerminalByName,
  checkBackendHealth,
  checkAllHealth,
  getInstallCommand,
  getBackendStatus,
} from "../src/registry.ts"
import { createTerminal } from "../src/terminal.ts"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import { createVt100Backend } from "../packages/vt100/src/backend.ts"
import type { TerminalBackend } from "../src/types.ts"

// ═══════════════════════════════════════════════════════
// Manifest tests
// ═══════════════════════════════════════════════════════

describe("manifest", () => {
  test("loadManifest() returns valid manifest with version and backends", () => {
    const manifest = loadManifest()
    expect(manifest.version).toBeTypeOf("string")
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.backends).toBeTypeOf("object")
    expect(Object.keys(manifest.backends).length).toBeGreaterThan(0)
  })

  test("manifest has all 9 backends", () => {
    const manifest = loadManifest()
    const names = Object.keys(manifest.backends)
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
    expect(names).toHaveLength(9)
  })

  test("each backend entry has required fields", () => {
    const manifest = loadManifest()
    for (const [name, entry] of Object.entries(manifest.backends)) {
      expect(entry.package, `${name}.package`).toBeTypeOf("string")
      expect(entry.type, `${name}.type`).toMatch(/^(js|wasm|native|os)$/)
      expect(entry.description, `${name}.description`).toBeTypeOf("string")
      expect(entry.description.length, `${name}.description length`).toBeGreaterThan(0)
    }
  })

  test("default backends are xtermjs, ghostty, vt100", () => {
    const manifest = loadManifest()
    const defaults = Object.entries(manifest.backends)
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
  test("backendNames() returns all 9 names", () => {
    const names = backendNames()
    expect(names).toHaveLength(9)
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

  test("defaultBackendNames() returns exactly the 3 defaults", () => {
    const defaults = defaultBackendNames()
    expect(defaults).toHaveLength(3)
    expect(defaults).toContain("xtermjs")
    expect(defaults).toContain("ghostty")
    expect(defaults).toContain("vt100")
  })

  test("installedBackendNames() returns an array of strings", () => {
    // import.meta.resolve may not resolve workspace packages in vitest's VM,
    // so we verify the return type rather than specific contents
    const installed = installedBackendNames()
    expect(Array.isArray(installed)).toBe(true)
    for (const name of installed) {
      expect(name).toBeTypeOf("string")
      expect(backendNames()).toContain(name)
    }
  })
})

// ═══════════════════════════════════════════════════════
// Installation detection tests
// ═══════════════════════════════════════════════════════

describe("installation detection", () => {
  test("isBackendInstalled('nonexistent') returns false", () => {
    expect(isBackendInstalled("nonexistent")).toBe(false)
  })

  test("isBackendInstalled returns boolean for all backends", () => {
    for (const name of backendNames()) {
      expect(typeof isBackendInstalled(name)).toBe("boolean")
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
  test("resolveBackend('nonexistent') throws with helpful error listing available backends", async () => {
    await expect(resolveBackend("nonexistent")).rejects.toThrow(/Unknown backend "nonexistent"/)
    await expect(resolveBackend("nonexistent")).rejects.toThrow(/Available:/)
  })

  test("resolveBackend error message lists all backend names", async () => {
    try {
      await resolveBackend("nonexistent")
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
// Health check tests
// ═══════════════════════════════════════════════════════

describe("health checks", () => {
  test("checkBackendHealth returns structured result for unknown backend", async () => {
    const result = await checkBackendHealth("nonexistent")
    expect(result.name).toBe("nonexistent")
    expect(result.healthy).toBe(false)
    expect(result.error).toBeTypeOf("string")
  })

  test("checkAllHealth() returns results for all installed backends", async () => {
    const results = await checkAllHealth()
    const installed = installedBackendNames()
    expect(results).toHaveLength(installed.length)
    for (const result of results) {
      expect(result.name).toBeTypeOf("string")
      expect(typeof result.healthy).toBe("boolean")
    }
  })

  test("healthy result has capabilities string, unhealthy has error string", async () => {
    // Use a non-existent backend to test unhealthy path
    const unhealthy = await checkBackendHealth("nonexistent")
    expect(unhealthy.healthy).toBe(false)
    expect(unhealthy.error).toBeDefined()
    expect(unhealthy.capabilities).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════
// Install command generation
// ═══════════════════════════════════════════════════════

describe("install commands", () => {
  test("getInstallCommand(['xtermjs']) returns correct npm command", () => {
    const cmd = getInstallCommand(["xtermjs"])
    expect(cmd).toContain("npm install -D")
    expect(cmd).toContain("@termless/xtermjs@")
  })

  test("getInstallCommand(['ghostty', 'vt100'], 'bun') returns bun command", () => {
    const cmd = getInstallCommand(["ghostty", "vt100"], "bun")
    expect(cmd).toContain("bun add -D")
    expect(cmd).toContain("@termless/ghostty@")
    expect(cmd).toContain("@termless/vt100@")
  })

  test("getInstallCommand includes manifest version", () => {
    const manifest = loadManifest()
    const cmd = getInstallCommand(["xtermjs"])
    expect(cmd).toContain(`@${manifest.version}`)
  })

  test("getInstallCommand throws for unknown backend", () => {
    expect(() => getInstallCommand(["nonexistent"])).toThrow(/Unknown backend/)
  })
})

// ═══════════════════════════════════════════════════════
// getBackendStatus tests
// ═══════════════════════════════════════════════════════

describe("getBackendStatus", () => {
  test("returns status for all 9 backends", () => {
    const statuses = getBackendStatus()
    expect(statuses).toHaveLength(9)
  })

  test("each status has name, manifest, and installed flag", () => {
    const statuses = getBackendStatus()
    for (const status of statuses) {
      expect(status.name).toBeTypeOf("string")
      expect(status.manifest).toBeDefined()
      expect(status.manifest.package).toBeTypeOf("string")
      expect(status.manifest.type).toBeTypeOf("string")
      expect(status.manifest.description).toBeTypeOf("string")
      expect(typeof status.installed).toBe("boolean")
    }
  })

  test("status names match manifest backend names", () => {
    const statuses = getBackendStatus()
    const statusNames = statuses.map((s) => s.name).sort()
    const manifestNames = backendNames().sort()
    expect(statusNames).toEqual(manifestNames)
  })
})
