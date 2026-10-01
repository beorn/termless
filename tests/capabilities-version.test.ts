/**
 * @failure A backend can report a stale upstream version or try to load an unpinned release through NODE_PATH.
 * @level l1
 * @consumer Termless backend selection and capability metadata
 * @testonly none
 * @reach registry actual backend factories, isolated version cache
 */
import { afterAll, describe, expect, test } from "vitest"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

// The resolver captures its cache root at module load. Give it a private root
// before importing any production module so a refusal test can detect writes.
const cacheRoot = mkdtempSync(join(tmpdir(), "termless-capability-version-"))
const priorXdgCacheHome = process.env.XDG_CACHE_HOME
process.env.XDG_CACHE_HOME = cacheRoot

afterAll(() => {
  if (priorXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = priorXdgCacheHome
  rmSync(cacheRoot, { recursive: true, force: true })
})

describe("backend capability version contract", () => {
  test("every manifest backend reports its pinned upstream release", async () => {
    const registry = await import("../src/backend/backends.ts")
    const factories = {
      xtermjs: (await import("../packages/xtermjs/src/backend.ts")).createXtermBackend,
      ghostty: (await import("../packages/ghostty/src/backend.ts")).createGhosttyBackend,
      vt100: (await import("../packages/vt100/src/backend.ts")).createVt100Backend,
      vt220: (await import("../packages/vt220/src/backend.ts")).createVt220Backend,
      vterm: (await import("../packages/vterm/src/backend.ts")).createVtermBackend,
      alacritty: (await import("../packages/alacritty/src/backend.ts")).createAlacrittyBackend,
      wezterm: (await import("../packages/wezterm/src/backend.ts")).createWeztermBackend,
      peekaboo: (await import("../packages/peekaboo/src/backend.ts")).createPeekabooBackend,
      "vt100-rust": (await import("../packages/vt100-rust/src/backend.ts")).createVt100RustBackend,
      libvterm: (await import("../packages/libvterm/src/backend.ts")).createLibvtermBackend,
      "ghostty-native": (await import("../packages/ghostty-native/src/backend.ts")).createGhosttyNativeBackend,
      kitty: (await import("../packages/kitty/src/backend.ts")).createKittyBackend,
    }

    for (const name of registry.backends()) {
      const pinnedVersion = registry.entry(name)?.version
      expect(factories[name as keyof typeof factories], `${name} has an actual backend factory`).toBeTypeOf("function")
      const backend = factories[name as keyof typeof factories]!()
      expect(backend.capabilities.version, `${name} capability version`).toBe(pinnedVersion ?? "not-applicable")
    }
  })

  test("a non-default version is refused before its isolated cache can be created", async () => {
    const registry = await import("../src/backend/backends.ts")
    const pinnedVersion = registry.entry("xtermjs")!.version!
    const requestedVersion = `0.0.0-c10.${randomUUID().replaceAll("-", "")}`
    const cachePath = join(cacheRoot, "termless", "backends", `npm:_xterm_headless-${requestedVersion}`)
    const cacheParent = join(cacheRoot, "termless", "backends")
    mkdirSync(cacheParent, { recursive: true })
    const sentinel = "must remain untouched"
    writeFileSync(cachePath, sentinel)

    await expect(registry.backend("xtermjs", { version: requestedVersion })).rejects.toThrow(
      `Backend "xtermjs" cannot select ${requestedVersion}; its pinned upstream release is ${pinnedVersion}`,
    )
    expect(readFileSync(cachePath, "utf8")).toBe(sentinel)

    await expect(registry.backend("alacritty", { version: "0.25.0" })).rejects.toThrow(
      'Version-pinned resolution for native backend "alacritty" requires nix.',
    )
  })

  test("a request for the pinned default does not take the non-default refusal", async () => {
    const registry = await import("../src/backend/backends.ts")
    const pinnedVersion = registry.entry("xtermjs")!.version!

    let resolved: Awaited<ReturnType<typeof registry.backend>> | undefined
    let failure: unknown
    try {
      resolved = await registry.backend("xtermjs", { version: pinnedVersion })
    } catch (error) {
      failure = error
    }

    if (resolved) {
      expect(resolved.capabilities.version).toBe(pinnedVersion)
    } else {
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toMatch(/^Backend "xtermjs" is not installed\./)
    }
  })
})
