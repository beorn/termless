/**
 * Vitest snapshot serializer for terminal state.
 *
 * Renders terminal buffer as a human-readable text snapshot with header
 * (dimensions, cursor, modes) and numbered lines. Non-default cell styles
 * are annotated inline.
 *
 * Register with vitest:
 *   import { terminalSerializer } from "@termless/test"
 *   expect.addSnapshotSerializer(terminalSerializer)
 */

import type { TerminalReadable, Cell, RGB } from "../../../src/types.ts"

// =============================================================================
// Snapshot Marker
// =============================================================================

/** Marker interface for objects that should be serialized as terminal snapshots. */
export interface TerminalSnapshotMarker {
  __terminalSnapshot: true
  terminal: TerminalReadable
  name?: string
}

/** Wrap a TerminalReadable for snapshot serialization. */
export function terminalSnapshot(terminal: TerminalReadable, name?: string): TerminalSnapshotMarker {
  return { __terminalSnapshot: true, terminal, name }
}

// =============================================================================
// Helpers
// =============================================================================

function formatRgb(color: RGB): string {
  return `#${color.r.toString(16).padStart(2, "0")}${color.g.toString(16).padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`
}

/** Extract style annotations for non-default cells in a line. */
function getLineAnnotations(line: Cell[]): string {
  const annotations: string[] = []

  for (let col = 0; col < line.length; col++) {
    const cell = line[col]
    if (!cell) continue

    const parts: string[] = []
    if (cell.fg) parts.push(`fg:${formatRgb(cell.fg)}`)
    if (cell.bg) parts.push(`bg:${formatRgb(cell.bg)}`)
    if (cell.bold) parts.push("bold")
    if (cell.dim) parts.push("dim")
    if (cell.italic) parts.push("italic")
    if (cell.underline !== false) parts.push(`underline:${cell.underline}`)
    if (cell.strikethrough) parts.push("strike")
    if (cell.inverse) parts.push("inverse")
    if (cell.wide) parts.push("wide")

    if (parts.length > 0) {
      annotations.push(`[${col}:${parts.join(" ")}]`)
    }
  }

  return annotations.join(" ")
}

// =============================================================================
// Serializer
// =============================================================================

export const terminalSerializer = {
  /** Returns true if the value is a terminal snapshot marker. */
  test(val: unknown): boolean {
    return (
      val !== null &&
      typeof val === "object" &&
      "__terminalSnapshot" in (val as Record<string, unknown>) &&
      (val as Record<string, unknown>).__terminalSnapshot === true
    )
  },

  /** Serialize a terminal state as a readable text snapshot. */
  serialize(val: TerminalSnapshotMarker): string {
    const { terminal } = val
    const cursor = terminal.getCursor()
    const lines = terminal.getLines()
    const altScreen = terminal.getMode("altScreen")

    const cols = lines[0]?.length ?? 0
    let header = `# terminal ${cols}x${lines.length}`
    header += ` | cursor (${cursor.x},${cursor.y}) ${cursor.visible ? "visible" : "hidden"} ${cursor.style}`
    if (altScreen) header += " | altScreen"
    if (val.name) header += ` | ${val.name}`

    const sep = "\u2500".repeat(50)
    const body = lines
      .map((line, row) => {
        const num = String(row + 1).padStart(2)
        const text = line.map((c) => c.char || " ").join("")
        const annotations = getLineAnnotations(line)
        return `${num}\u2502${text}${annotations ? "  " + annotations : ""}`
      })
      .join("\n")

    return `${header}\n${sep}\n${body}`
  },
}
