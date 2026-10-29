/**
 * @failure Rust vt100 cell readback drops SGR 2/22 dim state at the native binding.
 * @level l0
 * @consumer Termless Rust vt100 backend cell observations.
 * @testonly none
 */

import { describe, test, expect } from "vitest"
import { createVt100RustBackend, loadVt100RustNative } from "../src/backend.ts"

let nativeBuildError: string | null = null
try {
  loadVt100RustNative()
} catch (error) {
  nativeBuildError = error instanceof Error ? error.message : String(error)
}

describe.skipIf(nativeBuildError !== null)(`Rust vt100 backend attributes${nativeBuildError ? ` (unavailable: ${nativeBuildError})` : ""}`, () => {
  test("reports dim set and reset on distinct cells", () => {
    const backend = createVt100RustBackend()
    backend.init({ cols: 4, rows: 1 })
    try {
      backend.feed(new TextEncoder().encode("\x1b[2mA\x1b[22mB"))
      expect(backend.getCell(0, 0).dim).toBe(true)
      expect(backend.getCell(0, 1).dim).toBe(false)
    } finally {
      backend.destroy()
    }
  })
})
