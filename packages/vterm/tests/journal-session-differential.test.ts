/**
 * @failure  Replaying a recorded terminal-session JOURNAL (km/hab's
 *   `@hh/terminal-session` shape, bridged to `JournalReplayInput`) through
 *   vtermGuest produces different cells than the reference xtermGuest — or a
 *   journal event class (input/resize/lifecycle/truncation) is mishandled by
 *   the replay path at the guest seam.
 * @level  l1 — two emulators side by side fed from a parsed journal fixture;
 *   no React/IO/PTY.
 * @consumer  @si/vterm/21016-terminal-runtime acceptance ("compare live/replay
 *   paths across recorded journals and at least one external corpus") and
 *   @si/vterm/21016-terminal-runtime/21017-conformance-seed ("run a recorded
 *   `.hts` or external terminal corpus through vterm and at least one
 *   comparison path"). Split of labor: cast-session-differential.test.ts is
 *   the external-corpus half (asciicast recordings); THIS file is the
 *   recorded-journal half — the SAME `replayJournal` core that Hab restore
 *   tests use, driven through BOTH guests via `JournalReplayTarget`. A bundled
 *   fixture pins zero divergence and the event-class semantics (input never
 *   feeds the write side; resize mid-stream applies to both; lifecycle
 *   surfaces in order). TERMLESS_JOURNAL_DIR points at a directory of
 *   `*.json` `JournalReplayInput` files (e.g. real `journal.hts` sessions
 *   converted by the `@hab/terminal-session-termless` bridge) — each must
 *   replay to completion; divergence is reported as conformance-backlog
 *   seeds, not failed, until a curated set graduates to pinned expectations.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { xtermGuest, type XtermGuestHandle } from "@termless/xtermjs"
import { describe, expect, test } from "vitest"
import {
  parseJournalFixture,
  replayJournal,
  type JournalReplayResult,
  type JournalReplayTarget,
} from "../../../src/recording/journal-replay.ts"
import { vtermGuest, type VtermGuestHandle } from "../src/viewport-adapter.ts"
import { type CellDiff, ctx, diffCells, flush } from "./differential-helpers.ts"

function guestTarget(guest: VtermGuestHandle | XtermGuestHandle): JournalReplayTarget {
  return {
    feed: (data) => guest.feedAnsi(data),
    resize: (cols, rows) => guest.size.requestResize(cols, rows),
  }
}

interface JournalDifferential {
  diffs: CellDiff[]
  xterm: JournalReplayResult
  vterm: JournalReplayResult
  finalSize: { cols: number; rows: number }
}

/** Replay one parsed journal through both guests and diff the final grids. */
async function replayJournalBoth(source: string): Promise<JournalDifferential> {
  const input = parseJournalFixture(source)
  const cols = Math.min(input.size?.cols ?? 80, 250)
  const rows = Math.min(input.size?.rows ?? 24, 100)
  const x = (await xtermGuest({ cols, rows, scrollback: 0 }).init(ctx(cols, rows))) as XtermGuestHandle
  const v = (await vtermGuest({ cols, rows, scrollback: 0 }).init(ctx(cols, rows))) as VtermGuestHandle
  try {
    const xResult = replayJournal(input, guestTarget(x))
    const vResult = replayJournal(input, guestTarget(v))
    await flush()
    return {
      diffs: diffCells(x.output.buffer, v.output.buffer),
      xterm: xResult,
      vterm: vResult,
      finalSize: { cols: v.output.buffer.cols, rows: v.output.buffer.rows },
    }
  } finally {
    x.dispose()
    v.dispose()
  }
}

const FIXTURES = join(import.meta.dirname, "fixtures")

describe("journal session differential — vtermGuest ⇔ xtermGuest over recorded journals", () => {
  test("bundled fixture replays with ZERO divergence and correct event-class semantics", async () => {
    const source = readFileSync(join(FIXTURES, "hello-journal.json"), "utf8")
    const { diffs, xterm, vterm, finalSize } = await replayJournalBoth(source)

    // Both guests saw the identical replay: 5 output + 1 resize applied;
    // the input keystroke event was NOT fed; lifecycle surfaced in order.
    for (const result of [xterm, vterm]) {
      expect(result.applied).toBe(6)
      expect(result.lifecycle).toEqual(["awake", "exited"])
      expect(result.truncations).toEqual([])
    }
    // The mid-stream resize reached the emulators (40x10 -> 60x12).
    expect(finalSize).toEqual({ cols: 60, rows: 12 })
    expect(diffs).toEqual([])
  })

  // Recorded-journal corpus hook: point TERMLESS_JOURNAL_DIR at a directory
  // of `*.json` JournalReplayInput files — real `journal.hts` sessions pass
  // through `decodeTerminalEvents` + `journalEventsToReplayInput` (the
  // @hab/terminal-session-termless bridge) to produce them. Every file must
  // parse and replay to completion; the per-file divergence report surfaces
  // so a curated session set can graduate to pinned expectations like the
  // byte-level differential's D1–D5 set.
  const corpusDir = process.env.TERMLESS_JOURNAL_DIR
  test.skipIf(!corpusDir)("recorded-journal corpus replays to completion with a divergence report", async () => {
    const files = readdirSync(corpusDir as string)
      .filter((f) => f.endsWith(".json"))
      .sort()
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(join(corpusDir as string, file), "utf8")
      const { diffs, xterm } = await replayJournalBoth(source)
      console.log(
        `journal-corpus: ${file} — ${xterm.applied} applied event(s), ` +
          `${xterm.truncations.length} truncation(s), ${diffs.length} divergent cell(s)`,
      )
      for (const d of diffs.slice(0, 10)) {
        console.log(`  [${d.row},${d.col}] xterm=${d.xterm} vterm=${d.vterm}`)
      }
    }
  })
})
