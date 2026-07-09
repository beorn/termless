/**
 * Engine differential runner.
 *
 * Feeds each corpus byte stream to BOTH terminal engines — the xterm.js
 * reference and the vterm.js guest — at the stream's geometry, then diffs the
 * two resulting cell grids with `diffBuffers`. The output is a per-stream
 * measurement of how far the guest diverges from the reference.
 *
 * Convention: xterm is the reference (`old`), vterm is the guest (`new`), so a
 * formatted diff line `text: 'x' -> 'y'` reads "xterm rendered x, vterm y".
 *
 * NO SILENT ERRORS (docs/principles.md § "Fail Loud, Fail Now"): if either
 * engine fails to produce a grid of the requested height for a stream, the
 * runner throws instead of recording a misleading zero-divergence result.
 */

import { diffBuffers } from "../../src/terminal/diff.ts"
import { createXtermBackend } from "../../packages/xtermjs/src/backend.ts"
import { createVtermBackend } from "../../packages/vterm/src/backend.ts"
import type { TerminalBackend } from "../../src/terminal/types.ts"
import type { EngineStream } from "./corpus.ts"

/** One stream's measured divergence between the reference and guest engines. */
export interface EngineDifferentialResult {
  /** Stream name (matches EngineStream.name). */
  name: string
  /** True when the two engines produced identical grids. */
  equal: boolean
  /** Number of diverging cells (0 when equal). */
  diffCount: number
  /** Human-readable per-cell diff, or "Buffers are identical". */
  formatted: string
}

function feed(backend: TerminalBackend, bytes: Uint8Array): void {
  backend.feed(bytes)
}

/**
 * Feed one stream to a freshly-initialized backend and return it. The caller
 * owns destruction. Throws loudly if the backend did not yield a full grid —
 * that means init/feed silently failed and any diff would be meaningless.
 */
function render(
  create: () => TerminalBackend,
  engineLabel: string,
  s: EngineStream,
): TerminalBackend {
  const backend = create()
  backend.init({ cols: s.size.cols, rows: s.size.rows })
  feed(backend, s.bytes)
  const lines = backend.getLines()
  if (lines.length !== s.size.rows) {
    backend.destroy()
    throw new Error(
      `[engine-differential] ${engineLabel} produced ${lines.length} rows for stream ` +
        `"${s.name}" but ${s.size.rows} were requested — engine did not consume the stream`,
    )
  }
  return backend
}

/**
 * Run the full differential over a list of streams.
 *
 * For each stream: render it on the xterm reference and the vterm guest, diff
 * the grids, and record the result. Every stream is consumed by both engines or
 * the runner throws — a returned result is proof both engines ran.
 */
export function runEngineDifferential(streams: EngineStream[]): EngineDifferentialResult[] {
  return streams.map((s) => {
    const reference = render(createXtermBackend, "xterm(reference)", s)
    const guest = render(createVtermBackend, "vterm(guest)", s)
    try {
      const diff = diffBuffers(reference, guest)
      return {
        name: s.name,
        equal: diff.equal,
        diffCount: diff.diffs.length,
        formatted: diff.formatted,
      }
    } finally {
      reference.destroy()
      guest.destroy()
    }
  })
}
