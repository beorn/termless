/**
 * @failure A backend named in backends.json has no literal loader (or a loader has no manifest entry), so the
 *          km-daemon closure digest silently misses that backend and a change to it never restarts km
 *          (27837, @cto 26cf4eaa). The literal per-backend import map is what lets the closure follow every backend;
 *          a name in one list but not the other would silently hide a backend from the graph.
 * @level l2 - the real backends.json read beside the real loader map
 * @consumer @ag/hab/27754-assignment-unmanned-pages-a-working-seat-during-the-tribe-restart-a-landing-promotion-causes/27837-promotion-restarts-wire-unchanged
 * @reach fs-walk <fixture-only: reads backends.json beside the module, no source-tree walk>
 * @testonly none
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { backendLoaders } from "../src/backend/backend-loaders.ts"
import {
  hasExtension,
  type AdapterSourcesExtension,
  type ReplyDeliveryExtension,
  type TerminalBackend,
} from "../src/terminal/types.ts"

interface Manifest {
  backends: Record<string, { package: string; type: string }>
}

describe("backendLoaders matches backends.json", () => {
  // Universal identity AC: existing delivery tests cover only the eight delivery-capable engines.
  // This exercises the actual loader and keeps the three non-delivery engines outside that membership.
  test("every library backend exposes one source list without widening reply delivery", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..")
    const manifest = JSON.parse(readFileSync(join(root, "backends.json"), "utf8")) as Manifest
    const delivery: string[] = []
    const engines = Object.entries(manifest.backends).filter(([, entry]) => entry.type !== "os")
    expect(engines).toHaveLength(11)
    for (const [name, entry] of engines) {
      const loader = (backendLoaders as Record<string, () => Promise<unknown>>)[entry.package]
      if (!loader) throw new Error(`Missing backend loader ${name}`)
      const module = (await loader()) as { resolve(): Promise<TerminalBackend> }
      const backend = await module.resolve()
      expect(hasExtension<AdapterSourcesExtension>(backend, "adapter-sources"), name).toBe(true)
      if (!hasExtension<AdapterSourcesExtension>(backend, "adapter-sources"))
        throw new Error(`Missing adapter sources ${name}`)
      const sources = backend.getAdapterSources()
      expect(sources.length, name).toBeGreaterThan(0)
      expect(new Set(sources.map((source) => source.path)).size, name).toBe(sources.length)
      for (const source of sources) {
        expect(source.path, name).not.toMatch(/^(?:\/|\.\.)/)
        expect(source.blobOid, name).toMatch(/^[0-9a-f]{40}$/)
      }
      if (hasExtension<ReplyDeliveryExtension>(backend, "reply-delivery")) {
        delivery.push(name)
        expect(backend.replyDelivery.adapterSources, name).toBe(sources)
      }
    }
    expect(delivery.sort()).toEqual(["alacritty", "kitty", "libvterm", "vt100", "vt220", "vterm", "wezterm", "xtermjs"])
  })
  test("the loader map and the manifest name the same packages", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..")
    const manifest = JSON.parse(readFileSync(join(root, "backends.json"), "utf8")) as Manifest
    const declared = Object.values(manifest.backends)
      .map((entry) => entry.package)
      .sort()
    expect(Object.keys(backendLoaders).sort()).toEqual(declared)
  })
})
