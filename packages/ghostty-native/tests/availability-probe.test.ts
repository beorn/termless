/**
 * isGhosttyNativeAvailable — the non-throwing optional-native probe that lets
 * downstream suites skip-with-loud-note instead of hard-failing when the Zig
 * `.node` module is unbuilt. Env-agnostic: asserts the probe's CONTRACT (never
 * throws; agrees with the throwing loader), so it passes whether or not the
 * native module is present in the running environment.
 */

import { describe, expect, test } from "vitest"
import { isGhosttyNativeAvailable, loadGhosttyNative } from "../src/index.ts"

describe("isGhosttyNativeAvailable", () => {
  test("returns a boolean WITHOUT throwing, module present or not", () => {
    expect(typeof isGhosttyNativeAvailable()).toBe("boolean")
  })

  test("agrees with loadGhosttyNative: available ⇒ load succeeds, absent ⇒ load throws 'Build it first'", () => {
    if (isGhosttyNativeAvailable()) {
      expect(() => loadGhosttyNative()).not.toThrow()
    } else {
      expect(() => loadGhosttyNative()).toThrow(/Build it first/)
    }
  })
})
