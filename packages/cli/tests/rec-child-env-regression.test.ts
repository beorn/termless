/**
 * Regression — `termless rec` must spawn its child with `TERMLESS_REC=1`
 * in env. Bead `@km/termless/15589-rec-compositing-bleed-wrap/15621-rec-probe-ansi-leak`.
 *
 * Generic recording-mode signal — probe-driven TUIs (theme detection,
 * cursor-style queries, OSC 4/10/11) should bail to degrade-branch when
 * set. The headless backend feeding the rec frame doesn't reply to
 * probes, so probe-related literal text (`[?`, `^[<...>`) was leaking
 * into the live overlay during `km view` startup before this gate.
 *
 * The contract has two halves:
 *
 * 1. `REC_CHILD_ENV` exists, is frozen, and contains exactly the keys
 *    every honoring CLI is expected to recognize.
 * 2. The actual spawn site (the `spawnPty` call in `compatRecord`)
 *    passes `REC_CHILD_ENV` through to the child. This is asserted via
 *    a string check against the source file — the bug we are guarding
 *    against is "someone refactors record-cmd.ts and quietly drops the
 *    env arg", and the source check catches that without spinning up a
 *    full PTY in a non-TTY test environment.
 */

import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { REC_CHILD_ENV } from "../src/record-cmd.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const RECORD_CMD_PATH = join(HERE, "..", "src", "record-cmd.ts")

describe("REC_CHILD_ENV — the recording-mode env signal", () => {
  test("contains TERMLESS_REC=1 (the generic signal honoring CLIs check)", () => {
    expect(REC_CHILD_ENV).toEqual({ TERMLESS_REC: "1" })
  })

  test("is frozen — no runtime mutation", () => {
    expect(Object.isFrozen(REC_CHILD_ENV)).toBe(true)
  })
})

describe("record-cmd.ts spawnPty call site — passes REC_CHILD_ENV to child", () => {
  test("the spawnPty call merges REC_CHILD_ENV into the child's env", () => {
    // Pin the contract at the source level. The bug class this catches
    // is a future refactor that drops the `env: { ...REC_CHILD_ENV }`
    // line — at which point probe-leak corruption returns.
    const src = readFileSync(RECORD_CMD_PATH, "utf8")
    // Find the spawnPty({ ... }) call body and assert REC_CHILD_ENV is
    // passed in. Tolerate whitespace + comment lines between options.
    const spawnPtyCall = src.match(/spawnPty\(\{[^}]*\}/s)
    expect(spawnPtyCall, "spawnPty call site not found in record-cmd.ts").not.toBeNull()
    expect(spawnPtyCall![0]).toMatch(/env:\s*\{\s*\.{3}REC_CHILD_ENV\s*\}/)
  })
})
