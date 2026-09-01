/**
 * @failure  A terminal that has been RESHAPED stops surviving the snapshot
 *           codec: encode throws on a paired-array invariant, or
 *           decode(encode(s)) stops deep-equalling s, after the geometry
 *           churn that real sessions actually experience.
 * @level    l1
 * @consumer @i/5-agent-loop/vterm-codec-ends-recording — a live seat emitted
 *           `vterm snapshot codec: soft-wrap length 3580 != rowCount 2103`,
 *           stopped recording, and kept running. The screen engine was
 *           exonerated by the libvterm conformance suite (all four reflow
 *           cases pass), which pointed at SERIALIZATION instead.
 *
 * Why this lives here and not in vterm's own tests: the state generators are
 * the libvterm corpus's real reflow/resize cases, so the round-trip inherits
 * upstream's geometry churn — wrapped lines re-joined on widen, re-split on
 * narrow, cursors carried across the boundary — instead of screens invented
 * by whoever wrote the test. This package is the one place that can reach
 * both the corpus and `vterm.js`.
 */
import { describe, expect, test } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createVtermScreen, decodeScreenSnapshotBinary, encodeScreenSnapshotBinary, type VtermScreen } from "vterm.js"

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "corpus", "libvterm", "cases")
const encoder = new TextEncoder()

/** The slice of a corpus case this test drives; expectations are not our job. */
interface GeometryCase {
  name: string
  cols: number
  rows: number
  steps: { input?: string; resize?: { cols: number; rows: number } }[]
}

/** The corpus groups whose cases actually change geometry. */
const GEOMETRY_GROUPS = ["69screen_reflow", "63screen_resize", "16state_resize"] as const

function loadGeometryCases(): GeometryCase[] {
  const out: GeometryCase[] = []
  for (const group of GEOMETRY_GROUPS) {
    const dir = join(CORPUS, group)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".json")) continue
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        name: string
        cols: number
        rows: number
        input?: string
        steps?: { input?: string; resize?: { cols: number; rows: number } }[]
      }
      const steps = raw.steps ?? (raw.input === undefined ? [] : [{ input: raw.input }])
      if (steps.length === 0) continue
      out.push({ name: `${group} :: ${raw.name}`, cols: raw.cols, rows: raw.rows, steps })
    }
  }
  return out
}

const cases = loadGeometryCases()

/** Encode → decode → must deep-equal, and the paired arrays must agree. */
function assertSurvivesCodec(screen: VtermScreen, where: string): void {
  const snapshot = screen.snapshot()
  // The production failure was exactly this pairing, on the scrollback grid.
  expect(snapshot.scrollbackSoftWrapped, `${where}: scrollback soft-wrap pairing`).toHaveLength(
    snapshot.scrollback.length,
  )
  expect(snapshot.main.softWrapped, `${where}: main soft-wrap pairing`).toHaveLength(snapshot.main.grid.length)
  expect(snapshot.alt.softWrapped, `${where}: alt soft-wrap pairing`).toHaveLength(snapshot.alt.grid.length)
  expect(decodeScreenSnapshotBinary(encodeScreenSnapshotBinary(snapshot)), `${where}: round-trip`).toEqual(snapshot)
}

describe("snapshot codec survives corpus reflow states", () => {
  test("the geometry corpus is actually present (a silent zero would prove nothing)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10)
  })

  for (const kase of cases) {
    test(kase.name, () => {
      const screen = createVtermScreen({ cols: kase.cols, rows: kase.rows, scrollbackLimit: 1000 })
      assertSurvivesCodec(screen, "initial")
      for (const [i, step] of kase.steps.entries()) {
        // Same order the corpus runner uses: bytes, then geometry.
        if (step.input !== undefined) screen.process(encoder.encode(step.input))
        if (step.resize !== undefined) screen.resize(step.resize.cols, step.resize.rows)
        assertSurvivesCodec(screen, `step ${String(i)}`)
      }
    })
  }

  /**
   * The production screen was not small: ~1477 scrollback rows banked before
   * an `ESC [ 3 J`, ~2103 after it. Corpus screens are 5x10 to 80x25, so on
   * their own they would never have caught it — the codec chunks and interns,
   * and depth is the variable that decides whether a boundary is crossed.
   *
   * This drives a real corpus reflow case on top of production-scale
   * scrollback, including the clear that orphaned the flag array.
   */
  test("deep scrollback + ED 3 + corpus reflow geometry round-trips", () => {
    const reflow = cases.find((c) => c.name.includes("reflows wide lines")) ?? cases[0]
    expect(reflow, "a reflow case to borrow geometry from").toBeDefined()
    const screen = createVtermScreen({ cols: 80, rows: 24, scrollbackLimit: 4000 })
    const feed = (text: string): void => screen.process(encoder.encode(text))

    feed(Array.from({ length: 1477 }, (_, i) => `pre ${String(i)} ${"a".repeat(i % 120)}\r\n`).join(""))
    expect(screen.getScrollbackLength()).toBeGreaterThan(1400)
    feed("\x1b[3J")
    feed(Array.from({ length: 2103 }, (_, i) => `post ${String(i)} ${"b".repeat(i % 120)}\r\n`).join(""))
    expect(screen.getScrollbackLength()).toBeGreaterThan(2000)
    assertSurvivesCodec(screen, "deep scrollback after ED 3")

    // Now apply the corpus case's own geometry churn on top of that depth.
    for (const [i, step] of (reflow?.steps ?? []).entries()) {
      if (step.input !== undefined) feed(step.input)
      if (step.resize !== undefined) screen.resize(step.resize.cols, step.resize.rows)
      assertSurvivesCodec(screen, `deep + corpus step ${String(i)}`)
    }
  })
})
