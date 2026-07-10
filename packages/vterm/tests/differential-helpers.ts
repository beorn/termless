/**
 * Shared plumbing for the session-differential tests (cast + journal):
 * a minimal IslandContext, the settle flush, and the cell-grid diff.
 * Not a test file — imported by the *-session-differential.test.ts pair.
 */
import type { Cell, CellBuffer, IslandContext, IslandSignal } from "../src/silvery-compat.ts"

export function ctx(cols: number, rows: number): IslandContext {
  return {
    cols,
    rows,
    emit: (_signal: IslandSignal) => {},
    requestResize: () => {},
    execOSC: () => Promise.resolve(),
    abortSignal: new AbortController().signal,
    now: () => 0,
  }
}

// xtermGuest re-snapshots on a microtask; vtermGuest reads live. Two ticks
// settle both so the comparison is between two SETTLED buffers.
export async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function attrsKey(c: Cell): string {
  return Object.keys(c.attrs)
    .sort()
    .map((k) => `${k}=${(c.attrs as Record<string, unknown>)[k]}`)
    .join(",")
}

export function cellKey(c: Cell): string {
  return `${JSON.stringify(c.char)}|${c.fg}|${c.bg}|${c.wide}|${c.continuation}|${attrsKey(c)}`
}

export type CellDiff = { row: number; col: number; xterm: string; vterm: string }

export function diffCells(x: CellBuffer, v: CellBuffer): CellDiff[] {
  const rows = Math.max(x.rows, v.rows)
  const cols = Math.max(x.cols, v.cols)
  const diffs: CellDiff[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const xc = cellKey(x.getCell(col, row))
      const vc = cellKey(v.getCell(col, row))
      if (xc !== vc) diffs.push({ row, col, xterm: xc, vterm: vc })
    }
  }
  return diffs
}
