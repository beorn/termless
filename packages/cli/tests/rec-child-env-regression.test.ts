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
 * 1. `REC_CHILD_ENV` exists, is frozen, and contains exactly the generic
 *    recording-mode keys every honoring CLI is expected to recognize.
 * 2. `recordingChildEnv()` adds a temp DEBUG_LOG when the caller did not
 *    provide one, so child TUI diagnostic replay does not paint into rec.
 * 3. The actual spawn site (the `spawnPty` call in `interactiveRecord`)
 *    passes `recordingChildEnv()` through to the child. This is asserted via
 *    a string check against the source file — the bug we are guarding
 *    against is "someone refactors record-cmd.ts and quietly drops the env
 *    arg", and the source check catches that without spinning up a full PTY
 *    in a non-TTY test environment.
 */

import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { REC_CHILD_ENV, recordingChildDebugLogPath, recordingChildEnv } from "../src/record-cmd.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const RECORD_CMD_PATH = join(HERE, "..", "src", "record-cmd.ts")

describe("REC_CHILD_ENV — the recording-mode env signal", () => {
  test("contains TERMLESS_REC=1 (the generic signal honoring CLIs check)", () => {
    expect(REC_CHILD_ENV).toEqual({ TERMLESS_REC: "1" })
  })

  test("is frozen — no runtime mutation", () => {
    expect(Object.isFrozen(REC_CHILD_ENV)).toBe(true)
  })

  test("adds a temp DEBUG_LOG when the caller did not provide one", () => {
    expect(recordingChildDebugLogPath(123, 456)).toMatch(/termless-rec-child-456-123\.log$/)
    expect(recordingChildEnv({}).DEBUG_LOG).toMatch(/termless-rec-child-\d+-\d+\.log$/)
    expect(recordingChildEnv({}).LOG_LEVEL).toBe("warn")
  })

  test("preserves caller DEBUG_LOG when already configured", () => {
    expect(recordingChildEnv({ DEBUG_LOG: "/tmp/user.log", LOG_LEVEL: "debug" })).toEqual({
      TERMLESS_REC: "1",
      DEBUG_LOG: "/tmp/user.log",
      LOG_LEVEL: "debug",
    })
  })

  test("excludes silvery guard chatter from broad DEBUG filters", () => {
    expect(recordingChildEnv({ DEBUG: "*" }).DEBUG).toBe("*,-silvery:guard")
    expect(recordingChildEnv({ DEBUG: "silvery:*" }).DEBUG).toBe("silvery:*,-silvery:guard")
    expect(recordingChildEnv({ DEBUG: "km:*,-silvery:guard" }).DEBUG).toBe("km:*,-silvery:guard")
  })
})

describe("record-cmd.ts spawnPty call site — passes recordingChildEnv to child", () => {
  test("the spawnPty call uses recordingChildEnv for the child's env", () => {
    // Pin the contract at the source level. The bug class this catches
    // is a future refactor that drops the `env: recordingChildEnv()` line —
    // at which point probe-leak or child diagnostic corruption returns.
    const src = readFileSync(RECORD_CMD_PATH, "utf8")
    // Find the spawnPty({ ... }) call body and assert recordingChildEnv is
    // passed in. Tolerate whitespace + comment lines between options.
    const spawnPtyCall = src.match(/spawnPty\(\{[^}]*\}/s)
    expect(spawnPtyCall, "spawnPty call site not found in record-cmd.ts").not.toBeNull()
    expect(spawnPtyCall![0]).toMatch(/env:\s*recordingChildEnv\(\)/)
  })
})
