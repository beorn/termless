import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync, realpathSync } from "node:fs"
import { hasExtension } from "../../../src/terminal/types.ts"
import { describe, test, expect } from "vitest"
import { createVt220Backend } from "../src/backend.ts"

describe("createVt220Backend", () => {
  // Accepted requirement: adapter-owned audited source determines reply eligibility.
  // Existing behavior tests exercise replies but cannot detect a missing/stale declaration.
  // CTO binding 3: hash actual resolved import bytes; committed/CI bytes are HEAD bytes.
  test("declares reply delivery bound to audited adapter and engine sources", () => {
    const backend = createVt220Backend({ cols: 80, rows: 24 })
    try {
      expect(hasExtension(backend, "reply-delivery")).toBe(true)
      if (!hasExtension<ReplyDeliveryExtension>(backend, "reply-delivery")) {
        throw new Error("initialized backend declares no reply delivery")
      }
      const declaration = backend.replyDelivery
      expect(declaration.boundary).toBe("feed-and-getCursor")
      const repo = fileURLToPath(new URL("../../../", import.meta.url))
      const entry = realpathSync(fileURLToPath(import.meta.resolve("vt220.js")))
      const engineRoot = dirname(dirname(entry))
      // A pre-commit hook exports the adapter repository's Git context; engines own another checkout.
      const engineGitEnv = { ...process.env }
      for (const key of ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete engineGitEnv[key]
      const repository = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd: engineRoot,
        env: engineGitEnv,
        encoding: "utf8",
      }).trim()
      const packagePath = execFileSync("git", ["rev-parse", "--show-prefix"], {
        cwd: engineRoot,
        env: engineGitEnv,
        encoding: "utf8",
      })
        .trim()
        .replace(/\/$/, "")
      const treeOid = execFileSync("git", ["rev-parse", `HEAD:${packagePath}`], {
        cwd: engineRoot,
        env: engineGitEnv,
        encoding: "utf8",
      }).trim()
      expect(declaration.engine).toEqual({ kind: "source", repository, treeOid })
      // Resolve the actual entry and implementation imports independently of declaration paths.
      const importedSources = [import.meta.resolve("../src/index.ts"), import.meta.resolve("../src/backend.ts")]
      expect(declaration.adapterSources).toEqual(
        importedSources.map((url) => {
          const target = realpathSync(fileURLToPath(url))
          const bytes = readFileSync(target)
          const blobOid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
          return { path: relative(repo, target), blobOid }
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
