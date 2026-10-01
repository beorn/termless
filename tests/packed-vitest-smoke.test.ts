/**
 * @failure Packed core imports successfully but its catalog lookup escapes the installed package.
 * @level l2
 * @consumer Node consumers of @termless/test and its required @termless/core peer.
 * @testonly none
 */
import { describe, expect, test } from "vitest"
import { backends, entry, manifest } from "@termless/core"
import { createTestTerminal } from "@termless/test"

describe("@termless/test packed artifact", () => {
  test("loads inside a supported Vitest runner", () => {
    expect(createTestTerminal).toBeTypeOf("function")
  })

  test("reads its installed core peer's catalog", () => {
    const catalog = manifest()
    expect(backends()).toEqual(Object.keys(catalog.backends))
    expect(entry("vt100")).toMatchObject({ package: "@termless/vt100", type: "js" })
  })
})
