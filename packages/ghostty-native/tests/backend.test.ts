/**
 * @failure Ghostty native cell readback drops SGR 5/25 blink state at the native binding.
 * @level l0
 * @consumer Termless Ghostty native backend cell observations.
 * @testonly none
 */

import { describe, test, expect } from "vitest"
import { createGhosttyNativeBackend, loadGhosttyNative } from "../src/backend.ts"

let nativeBuildError: string | null = null
try {
  loadGhosttyNative()
} catch (error) {
  nativeBuildError = error instanceof Error ? error.message : String(error)
}

describe.skipIf(nativeBuildError !== null)(
  `Ghostty native backend attributes${nativeBuildError ? ` (unavailable: ${nativeBuildError})` : ""}`,
  () => {
    test("reports blink set and reset on distinct cells", () => {
      const backend = createGhosttyNativeBackend()
      backend.init({ cols: 4, rows: 1 })
      try {
        backend.feed(new TextEncoder().encode("\x1b[5mA\x1b[25mB"))
        expect(backend.getCell(0, 0).blink).toBe(true)
        expect(backend.getCell(0, 1).blink).toBe(false)
      } finally {
        backend.destroy()
      }
    })
  },
)
