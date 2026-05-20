/**
 * Pure-logic smoke tests for `compat-screenshot`.
 *
 * Everything here is window-free — no terminal app is ever spawned, no
 * `screencapture` runs. Safe to run in the default `vitest run` / CI.
 *
 * The LIVE capture tests (which spawn a real terminal window) live in the
 * sibling `compat-screenshot.slow.test.ts` — excluded from the default run
 * AND hard-gated behind `TERMLESS_PEEKABOO_LIVE=1`.
 */

import { describe, it, expect } from "vitest"
import {
  buildWrapperScript,
  assertCompatCapable,
  isTerminalInstalled,
  getTerminalAdapter,
  compatToTerminalApp,
  COMPAT_TERMINAL_PREFERENCE,
} from "../src/index.ts"

const isMac = process.platform === "darwin"

describe("compat-screenshot: wrapper script", () => {
  it("cd's into the cwd and runs the command", () => {
    const script = buildWrapperScript("echo hello", "/tmp/work")
    expect(script).toContain("cd '/tmp/work'")
    expect(script).toContain("echo hello")
  })

  it("ends with an exec keep-alive so the window survives the command exit", () => {
    const script = buildWrapperScript("echo hi", "/tmp")
    expect(script.trimEnd().endsWith("exec /bin/bash --login")).toBe(true)
  })

  it("starts with a bash shebang", () => {
    expect(buildWrapperScript("ls", "/tmp").startsWith("#!/bin/bash")).toBe(true)
  })

  it("shell-quotes a cwd containing a single quote", () => {
    const script = buildWrapperScript("ls", "/tmp/it's here")
    expect(script).toContain(`cd '/tmp/it'\\''s here'`)
  })
})

describe("compat-screenshot: terminal detection", () => {
  it("has a stable preference order: ghostty > kitty > iterm > terminal", () => {
    expect([...COMPAT_TERMINAL_PREFERENCE]).toEqual(["ghostty", "kitty", "iterm", "terminal"])
  })

  it("maps compat terminal names to backend TerminalApp enum", () => {
    expect(compatToTerminalApp("iterm")).toBe("iterm2")
    expect(compatToTerminalApp("ghostty")).toBe("ghostty")
    expect(compatToTerminalApp("kitty")).toBe("kitty")
    expect(compatToTerminalApp("terminal")).toBe("terminal")
  })

  it("exposes an adapter for every supported terminal", () => {
    for (const t of COMPAT_TERMINAL_PREFERENCE) {
      const adapter = getTerminalAdapter(t)
      expect(adapter.terminal).toBe(t)
      expect(adapter.bundleName.length).toBeGreaterThan(0)
      expect(typeof adapter.launch).toBe("function")
      expect(typeof adapter.metadata).toBe("function")
    }
  })
})

describe("compat-screenshot: environment guards", () => {
  it("rejects non-macOS platforms with a clear, actionable message", async () => {
    if (isMac) {
      // Can't simulate non-macOS here. The non-darwin branch is exercised on
      // CI's linux/win runners; here we just confirm the guard is callable.
      expect(typeof assertCompatCapable).toBe("function")
      return
    }
    await expect(assertCompatCapable()).rejects.toThrow(/macOS-only/)
  })

  it("isTerminalInstalled resolves to a boolean and never throws", async () => {
    if (!isMac) {
      // The probe shells out to macOS-only tools — skip the assertion off-mac.
      return
    }
    // `mdfind` / `test` are read-only — no window is spawned.
    for (const t of COMPAT_TERMINAL_PREFERENCE) {
      await expect(isTerminalInstalled(t)).resolves.toBeTypeOf("boolean")
    }
  })
})
