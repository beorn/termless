/**
 * Journal replay: terminal-session journals drive termless backends.
 *
 * The fixture format is the structural JSON shape produced by km's
 * terminal-session adapters (bytes as base64). Cross-backend agreement on the
 * same journal is the conformance value: differences = emulator bugs.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { createVtermBackend } from "../packages/vterm/src/backend.ts"
import { createVt220Backend } from "../packages/vt220/src/backend.ts"
import { parseJournalFixture, replayJournal } from "../src/recording/journal-replay.ts"
import type { TerminalBackend } from "../src/terminal/types.ts"

const FIXTURE = readFileSync(join(__dirname, "fixtures", "journal", "shell-session.json"), "utf8")

type BackendFactory = () => Promise<TerminalBackend>
const backends: [string, BackendFactory][] = [
  [
    "vterm",
    async () => {
      const backend = createVtermBackend()
      await backend.init({ cols: 20, rows: 4 })
      return backend
    },
  ],
  [
    "vt220",
    async () => {
      const backend = createVt220Backend()
      await backend.init({ cols: 20, rows: 4 })
      return backend
    },
  ],
]

function visibleText(backend: TerminalBackend): string {
  return backend
    .getLines()
    .map((line) =>
      line
        .map((cell) => cell.char || " ")
        .join("")
        .replace(/\s+$/, ""),
    )
    .filter((line) => line.length > 0)
    .join("\n")
}

describe("journal replay through termless backends", () => {
  for (const [name, factory] of backends) {
    test(`${name}: replays output + resize; skips input; reports lifecycle + truncation`, async () => {
      const backend = await factory()
      const input = parseJournalFixture(FIXTURE)
      const result = replayJournal(input, backend)

      // 3 state mutations: two outputs + one resize.
      expect(result.applied).toBe(3)
      expect(result.truncations).toEqual([3])
      expect(result.lifecycle).toEqual(["launching", "awake", "exited"])

      const text = visibleText(backend)
      // Post-resize output is on-screen; input bytes ("echo hi") must NOT be.
      expect(text).toContain("after-resize")
      expect(text).not.toContain("echo hi")
    })
  }

  test("cross-backend conformance: vterm and vt220 agree on the visible text for the same journal", async () => {
    const input = parseJournalFixture(FIXTURE)
    const rendered = await Promise.all(
      backends.map(async ([name, factory]) => {
        const backend = await factory()
        replayJournal(input, backend)
        return [name, visibleText(backend)] as const
      }),
    )
    const [, vtermText] = rendered[0]!
    for (const [name, text] of rendered) {
      expect(text, `${name} diverged from vterm on the same journal`).toBe(vtermText)
    }
  })

  test("scrollback survives replay: pre-resize overflow lines are retained", async () => {
    const backend = createVtermBackend()
    await backend.init({ cols: 20, rows: 4 })
    replayJournal(parseJournalFixture(FIXTURE), backend)
    // After the resize the screen is 6 rows; the 5 pre-resize lines plus
    // post-resize output overflow it, so the buffer exceeds the screen.
    const scrollback = backend.getScrollback()
    expect(scrollback.totalLines).toBeGreaterThan(6)
  })

  test("malformed events fail loud", async () => {
    const backend = createVtermBackend()
    await backend.init({ cols: 20, rows: 4 })
    expect(() => replayJournal({ events: [{ kind: "output", offset: 1, at: 1 }] }, backend)).toThrow(/missing bytesB64/)
    expect(() => replayJournal({ events: [{ kind: "resize", offset: 1, at: 1 }] }, backend)).toThrow(/missing size/)
  })
})
