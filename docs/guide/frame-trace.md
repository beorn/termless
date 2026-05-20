# Frame-Trace Mode

Capture every render-relevant buffer change with timestamp + content-hash dedupe. Designed for frame-by-frame debugging of TUI rendering — "the border disappeared after frame 47, ANSI input was `\x1b[2K`."

## When to Use

Static screenshots capture a single moment. Frame-trace captures _every_ render-relevant moment so visual bugs become investigable in one pass instead of a five-round-trip "does this look right?" interaction.

Typical uses:

- Diagnosing layout flicker, intermittent border drops, mis-aligned glyphs
- Reproducing TUI race conditions tied to specific render sequences
- Generating regression baselines for visual diffing

## API

### Programmatic (Bun/Node)

```ts
import { createTerminal, createFrameTracer } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

let tracer: ReturnType<typeof createFrameTracer> | null = null
const terminal = createTerminal({
  backend: createXtermBackend({ cols: 140, rows: 40 }),
  cols: 140,
  rows: 40,
  onAfterWrite: (data) => tracer?.onWrite(data),
})

tracer = createFrameTracer(terminal, {
  dir: "/tmp/my-trace/",
  debounceMs: 16, // one frame interval — default
  maxFrames: 10_000, // safety cap — default
  dedupe: true, // skip PNG for identical hashes — default
  canvas: { cols: 140, rows: 40 },
})

await terminal.spawn(["bash", "-lc", "your-app"])

// ... drive the terminal ...

// Poll mid-run:
const frames = tracer.framesSinceSeq(0)

// Drain and stop:
const summary = await tracer.stop()
console.log(summary)
// {
//   count: 47,
//   uniqueCount: 23,
//   duplicateRatio: 0.51,
//   indexFile: "/tmp/my-trace/index.jsonl",
//   firstTs: 1747597815123,
//   lastTs: 1747597818456,
//   totalBytes: 1240394,
//   truncated: false
// }
```

### Tape Format

```tape
Set Frames "/tmp/my-trace/"
Set FrameDebounceMs 16
Set Width 140
Set Height 40

Type "echo hello"
Enter
Sleep 500ms
```

When the tape executes, the executor wires up frame-tracing automatically and exposes the summary on `result.frameTrace`.

## Frame Index Format

`index.jsonl` (one JSON object per line):

```jsonc
{
  "seq": 1,
  "ts": 1747597815123,
  "iso": "2026-05-18T23:30:15.123Z",
  "hash": "xxh64:7f2a91b3c4d5e6f0",
  "duplicate_of": null,
  "bytes_in_since_last": 47,
  "buffer": {
    "cols": 140,
    "rows": 40,
    "cursor": { "row": 5, "col": 22 }
  },
  "duration_since_prev_ms": 22,
  "png": "00001.png"
}
{ "seq": 2, "ts": 1747597815145, "hash": "xxh64:7f2a91b3c4d5e6f0", "duplicate_of": 1, "png": null }
```

JSONL is chosen over a JSON array so partial traces from a crashed session remain parseable up to the last fully-flushed line.

## HTML Viewer

Every trace gets a self-contained `viewer.html` written alongside `index.jsonl` — a scrubbable timeline UI for inspecting frames locally, with **no server**. `createFrameTracer().stop()` generates it automatically; double-click the file to open it in any browser.

```text
/tmp/my-trace/
  index.jsonl
  00001.png
  00002.png
  viewer.html   ← generated on stop()
```

The viewer inlines everything — the jsonl rows as a JSON blob and every PNG as a base64 data URI — so it works from `file://` with no cross-origin fetch.

Features:

- **Horizontal timeline** — one tick per frame; deduped frames are dimmed, idle gaps (inter-frame time well above the median) shown as wider gray bars.
- **Click to select** — a frame's PNG, ANSI-input preview, silvery state (when the row carries an optional `silvery` field), and bytes-in delta vs. the previous frame.
- **Keyboard scrub** — arrow keys plus vim-style `j` / `k` advance/retreat; `Home` / `End` jump to ends.
- **Find** — text search across the frames' ANSI-input previews; matching ticks are highlighted.
- **Filter** — a free-text predicate over each row's JSON; non-matching frames are hidden from the timeline.
- **Diff mode** — press `d`, pick two frames, and the viewer pixel-diffs them in-browser with a red overlay on changed pixels.

A ~1000-frame trace scrubs smoothly because all images are inlined up front — no per-frame fetch.

### Standalone generation

`writeViewer` is exported so you can (re)generate a viewer for an existing trace directory:

```ts
import { writeViewer } from "@termless/core"

const result = writeViewer("/tmp/my-trace/")
// { viewerFile, frameCount, imageCount, bytes }
```

## Design Notes

- **Dedupe via xxHash64** — Bun's built-in `Bun.hash.xxHash64`, with an FNV-1a fallback for Node. Collision rate is fine for a 10k-frame trace lifetime.
- **Debounce, not per-cell** — `debounceMs: 16` produces frame-per-render-pass for typical TUIs, not frame-per-cell-write. A 100ms output burst that ends in a stable state produces one frame, not many.
- **maxFrames cap** — the session continues but no new frames are written past the cap; the summary reports `truncated: true`.
- **Streaming-readable index** — append-only JSONL means a partial trace from a crashed session is readable up to the last fully-flushed row.

## MCP Surface

The `mcp__tty` MCP server exposes frame-trace via three tools:

```ts
mcp__tty__start({
  command: ["bun", "km", "view", "~/Vault"],
  cols: 140,
  rows: 40,
  frames: {
    dir: "/tmp/trace-15290/",
    debounceMs: 16,
  },
})

mcp__tty__trace({ sessionId, sinceSeq: 0 }) // poll live

mcp__tty__stop({ sessionId }) // returns summary
```
