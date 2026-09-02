/**
 * Emulator conformance in io vocabulary — the anchor's sketch, made a test:
 * the same recording through two emulators must show the same picture.
 *
 * The corpus runner (tests/corpus-conformance.test.ts) grades every backend
 * against mined expectations with the two-way known-gaps ledger; this is the
 * io-shaped seed of that grade — one Event stream, two Emulators, one
 * comparison — so the conformance question can be asked of anything that
 * implements Emulator, not only of a TerminalBackend.
 */

import { describe, expect, test } from "vitest"
import { createVtermBackend } from "../../packages/vterm/src/backend.ts"
import { createXtermBackend } from "../../packages/xtermjs/src/backend.ts"
import { micros, pipe, type Color, type Emulator, type Event } from "../../src/io/index.ts"
import { emulatorFromBackend } from "../../src/terminal/io-compat.ts"
import { createScreenView } from "../../src/terminal/views.ts"
import type { TerminalBackend } from "../../src/terminal/types.ts"
import { FIXTURE_SIZE, bytes, conformanceEvents } from "./fixtures.ts"

function emulatorOver(backend: TerminalBackend): { emulator: Emulator; close: () => void } {
  backend.init({ cols: FIXTURE_SIZE.cols, rows: FIXTURE_SIZE.rows })
  return { emulator: emulatorFromBackend(backend, FIXTURE_SIZE), close: () => backend.destroy() }
}

/**
 * The painted color only: `index` is identity metadata an engine may or may
 * not preserve (vterm reports the palette slot, xterm.js does not), and the
 * conformance question is what the user sees.
 */
function rgb(color: Color | null): { r: number; g: number; b: number } | null {
  return color ? { r: color.r, g: color.g, b: color.b } : null
}

async function replay(events: Event[], ...sinks: Emulator[]): Promise<void> {
  await pipe(
    (async function* () {
      for (const e of events) yield e
    })(),
    ...sinks,
  )
}

describe("emulator conformance: same recording, same picture", () => {
  test("the conformance stream paints the same screen on vterm and xterm", async () => {
    const vterm = emulatorOver(createVtermBackend())
    const xterm = emulatorOver(createXtermBackend())
    try {
      await replay(conformanceEvents(), vterm.emulator, xterm.emulator)
      expect(createScreenView(vterm.emulator).getText()).toBe(createScreenView(xterm.emulator).getText())
      expect(vterm.emulator.cursor.col).toBe(xterm.emulator.cursor.col)
      expect(vterm.emulator.cursor.row).toBe(xterm.emulator.cursor.row)
      expect(vterm.emulator.scrollback).toBe(xterm.emulator.scrollback)
    } finally {
      vterm.close()
      xterm.close()
    }
  })

  test("styled output and a resize agree cell for cell", async () => {
    const vterm = emulatorOver(createVtermBackend())
    const xterm = emulatorOver(createXtermBackend())
    try {
      const events: Event[] = [
        { at: micros(0), type: "output", data: bytes("\x1b[1;31mbold red\x1b[0m plain\r\n\x1b[4munder\x1b[0m") },
        { at: micros(1_000), type: "control", control: "resize", size: { cols: 40, rows: 10 } },
        { at: micros(2_000), type: "output", data: bytes("\r\nafter resize") },
      ]
      await replay(events, vterm.emulator, xterm.emulator)
      expect(vterm.emulator.size).toEqual(xterm.emulator.size)
      const rows = vterm.emulator.size.rows
      const cols = vterm.emulator.size.cols
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const a = vterm.emulator.getCell(vterm.emulator.scrollback + row, col)
          const b = xterm.emulator.getCell(xterm.emulator.scrollback + row, col)
          expect({
            row,
            col,
            char: a.char,
            bold: a.bold,
            underline: a.underline !== "none" && a.underline !== false,
            fg: rgb(a.fg),
          }).toEqual({
            row,
            col,
            char: b.char,
            bold: b.bold,
            underline: b.underline !== "none" && b.underline !== false,
            fg: rgb(b.fg),
          })
        }
      }
    } finally {
      vterm.close()
      xterm.close()
    }
  })
})
