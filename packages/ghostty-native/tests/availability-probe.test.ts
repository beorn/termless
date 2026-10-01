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

  test("agrees with loadGhosttyNative and keeps absence diagnostics actionable", () => {
    if (isGhosttyNativeAvailable()) {
      expect(() => loadGhosttyNative()).not.toThrow()
    } else {
      let failure: unknown
      try {
        loadGhosttyNative()
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      const error = failure as Error & { cause?: unknown }
      expect(error.message).toContain("Build it first from a full Termless source checkout")
      expect(error.message).toContain("cd packages/ghostty-native && bash build/build.sh")
      expect(error.message).toContain("Published packages omit build sources")
      expect(error.message).toContain("Tried:")
      expect(error.message).toContain("Load attempts:")
      expect(error.cause).toBeInstanceOf(Error)
      const cause = error.cause as Error
      expect(error.message.startsWith(cause.message)).toBe(true)
      expect(cause.message).toContain("../termless-ghostty-native.node")
      expect(cause.message).toContain("../native/zig-out/lib/termless-ghostty-native.node")
    }
  })
})
