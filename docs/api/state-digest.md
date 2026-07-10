---
title: State Digest API
description: terminalStateDigest and diffTerminalStates — one serializable "same terminal state" vocabulary for equivalence assertions across backends.
---

# API: State Digest

```typescript
import { terminalStateDigest, diffTerminalStates } from "@termless/core"
import type { TerminalStateDigest, TerminalStateDiff } from "@termless/core"
```

A **state digest** is a plain, serializable snapshot of everything that defines a terminal's observable state: geometry, cursor, title, modes, and the visible grid as text lines plus a per-row style signature. It answers one question — *are these two terminals in the same state?* — with one vocabulary, for any [backend](/concepts/backend) and for a live terminal versus a rehydrated one.

It reads through the shared [`TerminalReadable`](/api/terminal) contract, so the same equivalence check works across every emulator instead of each test suite hand-rolling its own comparison.

## What a digest is

```typescript
interface TerminalStateDigest {
  size: { cols: number; rows: number }   // terminal geometry
  cursor: DigestCursor                    // row/col + visibility + shape
  title: string
  modes: Record<TerminalMode, boolean>    // every TerminalMode, fixed order
  rows: DigestRow[]                        // the visible grid (the screen)
}

interface DigestCursor {
  row: number
  col: number
  visible: boolean | null
  style: CursorStyle | null
}

interface DigestRow {
  text: string    // the row's characters (trailing blanks trimmed by default)
  style: string   // canonical, run-length-encoded per-cell style signature
}
```

The grid captured is the **screen** (the visible live grid) — the last `size.rows` rows the backend exposes. Each row carries its `text` and a `style` signature that encodes the cells' colors and attributes independently of their characters, so a purely stylistic change (a color, a bold run) is caught even when the text is unchanged.

```typescript
const term = createTerminal({ backend: createVtermBackend() })
term.feed("\x1b[31mError\x1b[0m: not found")

const digest = terminalStateDigest(term)
digest.rows[0]
// { text: "Error: not found", style: "5:fg=#800000 11:-" }
//   ^ 5 red cells ("Error"), then 11 default cells (": not found")
```

Pass `{ trimTrailingBlanks: false }` to render each row at its full width instead of right-trimming blanks. Style signatures always span the full width regardless.

## Determinism

The digest is built so that **equal state produces a byte-identical `JSON.stringify`**:

- keys are emitted in a fixed order (`size`, `cursor`, `title`, `modes`, `rows`);
- `modes` is walked in a fixed mode order;
- every leaf is a string, number, boolean, or `null` — colors are flattened into the style signature, never nested objects.

So a digest is safe for cheap deep-equality (`toEqual`), stable inline snapshots, and comparison across processes, and it survives a JSON round-trip unchanged:

```typescript
const a = terminalStateDigest(termA)
const b = terminalStateDigest(termB)

// Two terminals fed identical bytes digest identically, to the byte:
expect(JSON.stringify(a)).toBe(JSON.stringify(b))

// And a digest round-trips through JSON losslessly:
expect(JSON.parse(JSON.stringify(a))).toEqual(a)
```

## Diffing two states

`diffTerminalStates(a, b)` turns two digests into a structured, human-readable difference. `equal` is `true` iff nothing differs; otherwise only the diverging dimensions are present, and `rows` lists every differing screen row in order.

```typescript
interface TerminalStateDiff {
  equal: boolean
  size?: { a: { cols: number; rows: number }; b: { cols: number; rows: number } }
  cursor?: { a: DigestCursor; b: DigestCursor }
  title?: { a: string; b: string }
  modes?: { mode: TerminalMode; a: boolean; b: boolean }[]
  rows?: { row: number; a: DigestRow; b: DigestRow }[]
  formatted: string   // "Terminal states are identical" when equal
}
```

```typescript
const live = terminalStateDigest(resident)
const restored = terminalStateDigest(reattached)

const diff = diffTerminalStates(live, restored)
if (!diff.equal) {
  console.log(diff.formatted)
  // cursor: (2,0) vs (0,0)
  // modes: altScreen false→true
  // row 2: "prompt$ " vs ""
}
```

Because a one-cell color change leaves the text intact but changes the row's `style` signature, the diff still names that row:

```typescript
const diff = diffTerminalStates(before, after)
expect(diff.rows).toHaveLength(1)
expect(diff.rows![0].row).toBe(1)           // divergence is on row 1
expect(diff.rows![0].a.text).toBe(diff.rows![0].b.text)   // text unchanged
expect(diff.rows![0].a.style).not.toBe(diff.rows![0].b.style)
```

## Relation to `diffBuffers`

`diffBuffers` compares two live terminals **cell-by-cell** (grid only) and reports which cells moved. The state digest is broader — it also captures cursor, modes, title, and geometry — and it is **serializable**, but it is row-granular for the grid. They compose over the same `TerminalReadable` contract; reach for `diffBuffers` when you want the exact changed cells, and for `terminalStateDigest` when you want a serializable "same whole-terminal state?" assertion or snapshot.
