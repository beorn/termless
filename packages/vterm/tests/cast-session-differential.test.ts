/**
 * @failure  Replaying a recorded terminal session (asciicast v2) through
 *   vtermGuest produces different cells than the reference xtermGuest — i.e.
 *   the engines agree on hand-picked byte snippets but diverge on realistic,
 *   ordered session streams, which byte-level unit cases can't catch.
 * @level  l1 — two emulators side by side fed from a parsed recording; no
 *   React/IO/PTY.
 * @consumer  @si/vterm/21016-terminal-runtime acceptance ("compare live/replay
 *   paths across recorded journals and at least one external corpus"). Split of
 *   labor: tests/corpus-conformance.test.ts runs the corpus/ suites (authored
 *   per-case conformance, pure backends, all engines); THIS file is the
 *   session-replay differential — whole recorded sessions through the GUEST
 *   seam (viewport/scrollback path). A bundled hand-authored fixture pins
 *   zero-divergence; TERMLESS_CAST_DIR points at any directory of .cast files
 *   (each replay must complete; its divergence report surfaces so a curated
 *   session set can graduate to pinned expectations). Sourcing external casts
 *   follows corpus/README.md licensing rules — no GPL/unlicensed vendoring.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { xtermGuest, type XtermGuestHandle } from "@termless/xtermjs"
import { describe, expect, test } from "vitest"
import { parseAsciicast } from "../../../src/recording/asciicast/reader.ts"
import { vtermGuest, type VtermGuestHandle } from "../src/viewport-adapter.ts"
import { type CellDiff, ctx, diffCells, flush } from "./differential-helpers.ts"

/**
 * Replay one parsed asciicast through both guests and report the final-grid
 * divergence. Output ("o") events feed both emulators in recorded order;
 * input ("i") and marker ("m") events are ignored — they never reach a
 * terminal's write side.
 */
async function replayCast(source: string): Promise<{ diffs: CellDiff[]; outputEvents: number }> {
  const cast = parseAsciicast(source)
  const cols = Math.min(cast.header.width, 250)
  const rows = Math.min(cast.header.height, 100)
  const x = (await xtermGuest({ cols, rows, scrollback: 0 }).init(ctx(cols, rows))) as XtermGuestHandle
  const v = (await vtermGuest({ cols, rows, scrollback: 0 }).init(ctx(cols, rows))) as VtermGuestHandle
  let outputEvents = 0
  try {
    for (const event of cast.events) {
      if (event.type !== "o") continue
      outputEvents++
      x.feedAnsi(event.data)
      v.feedAnsi(event.data)
    }
    await flush()
    return { diffs: diffCells(x.output.buffer, v.output.buffer), outputEvents }
  } finally {
    x.dispose()
    v.dispose()
  }
}

const FIXTURES = join(import.meta.dirname, "fixtures")

describe("cast session differential — vtermGuest ⇔ xtermGuest over recorded sessions", () => {
  test("bundled hand-authored fixture replays with ZERO divergence", async () => {
    const source = readFileSync(join(FIXTURES, "hello-parity.cast"), "utf8")
    const { diffs, outputEvents } = await replayCast(source)
    expect(outputEvents).toBeGreaterThan(0)
    expect(diffs).toEqual([])
  })

  // External corpus hook: point TERMLESS_CAST_DIR at a directory of .cast
  // files (e.g. a vendored third-party corpus once licensing is settled, or a
  // locally recorded session set). Every file must parse and replay to
  // completion; the divergence report per file is printed so a curated corpus
  // can graduate to pinned expectations like the byte-level differential's
  // D1–D5 set.
  const corpusDir = process.env.TERMLESS_CAST_DIR
  test.skipIf(!corpusDir)("external corpus replays to completion with a divergence report", async () => {
    const files = readdirSync(corpusDir as string)
      .filter((f) => f.endsWith(".cast"))
      .sort()
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(join(corpusDir as string, file), "utf8")
      const { diffs, outputEvents } = await replayCast(source)
      // Completion is the invariant; divergence is REPORTED (conformance-backlog
      // seeds), not failed, until the corpus is curated and pinned.
      console.log(`cast-corpus: ${file} — ${outputEvents} output event(s), ${diffs.length} divergent cell(s)`)
      for (const d of diffs.slice(0, 10)) {
        console.log(`  [${d.row},${d.col}] xterm=${d.xterm} vterm=${d.vterm}`)
      }
    }
  })
})
