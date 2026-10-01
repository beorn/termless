/**
 * @failure Packed test fixtures read a separate core registry or cannot enumerate its installed peer's catalog.
 * @level l2
 * @consumer Node consumers of @termless/test and its required @termless/core peer.
 * @testonly none
 */
import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { backends, entry, isReady, manifest } from "@termless/core"
import { createTestTerminal } from "@termless/test"
import { backendCases } from "@termless/test/fixture"

describe("@termless/test packed artifact", () => {
  test("loads inside a supported Vitest runner", () => {
    expect(createTestTerminal).toBeTypeOf("function")
  })

  test("reads its installed core peer's catalog", () => {
    const catalog = manifest()
    expect(backends()).toEqual(Object.keys(catalog.backends))
    expect(entry("vt100")).toMatchObject({ package: "@termless/vt100", type: "js" })
  })

  // Source-tree Vitest cannot resolve workspace peers through import.meta.resolve.
  // Only the source package declares this TS entry; isolated packed consumers run this case.
  const consumer = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  const sourceWorkspace = consumer.name === "@termless/core" && consumer.exports?.["."] === "./src/index.ts"
  test.skipIf(sourceWorkspace)("fixture default enumeration reads the public core registry", async () => {
    const name = `__packed_peer_probe_${process.pid}`
    const catalog = manifest()
    expect(catalog.backends[name]).toBeUndefined()
    catalog.backends[name] = { package: "@termless/core", upstream: null, version: null, type: "js" }
    try {
      expect(backends()).toContain(name)
      expect(isReady(name)).toBe(true)
      const cases = await backendCases()
      expect(cases.map((item) => item.name)).toContain(name)
    } finally {
      delete catalog.backends[name]
    }
  })
})
