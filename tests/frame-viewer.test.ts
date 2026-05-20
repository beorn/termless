import { afterEach, describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTerminal } from "../src/terminal.ts"
import { createFrameTracer } from "../src/frame-trace.ts"
import { writeViewer } from "../src/frame-viewer.ts"
import type { Terminal } from "../src/types.ts"

// Pure-TS backend — no native deps, fast for tests.
import { createVt100Backend } from "../packages/vt100/src/index.ts"

// A real (tiny) 1×1 PNG so base64-inlining + diff-canvas decoding has valid bytes.
const ONE_PX_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
  0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

async function pngRender(_term: Terminal): Promise<Uint8Array> {
  return ONE_PX_PNG
}

const dirs: string[] = []
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe("writeViewer + frame-trace integration", () => {
  test("createFrameTracer.stop() emits a self-contained viewer.html", async () => {
    const dir = tmp("frame-viewer-")
    let hook: ((data: Uint8Array) => void) | undefined
    const term = createTerminal({
      backend: createVt100Backend(),
      cols: 20,
      rows: 5,
      onAfterWrite: (data) => hook?.(data),
    })
    const tracer = createFrameTracer(term, { dir, debounceMs: 5, renderFn: pngRender })
    hook = tracer.onWrite

    term.feed("hello")
    await new Promise((r) => setTimeout(r, 30))
    term.feed(" world")
    await new Promise((r) => setTimeout(r, 30))

    const summary = await tracer.stop()
    expect(summary.count).toBeGreaterThanOrEqual(1)

    const viewerPath = join(dir, "viewer.html")
    const html = readFileSync(viewerPath, "utf-8")

    // Well-formed, non-empty document.
    expect(html.length).toBeGreaterThan(1000)
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html.trimEnd().endsWith("</html>")).toBe(true)

    // Key DOM ids present.
    for (const id of [
      "trace-data",
      "timeline",
      "preview-img",
      "diff-canvas",
      "find-input",
      "filter-input",
      "diff-toggle",
      "frame-info",
      "ansi-preview",
      "silvery-block",
    ]) {
      expect(html).toContain(`id="${id}"`)
    }

    // Inlined data payload is parseable JSON with the recorded frames.
    const m = html.match(/<script type="application\/json" id="trace-data">([\s\S]*?)<\/script>/)
    expect(m).not.toBeNull()
    const payload = JSON.parse(m![1]!.replace(/<\\\//g, "</"))
    expect(Array.isArray(payload.frames)).toBe(true)
    expect(payload.frames.length).toBe(summary.count)
    expect(payload.frames[0].seq).toBe(1)

    // PNGs inlined as base64 data URIs (not file:// references).
    const imageKeys = Object.keys(payload.images)
    expect(imageKeys.length).toBeGreaterThanOrEqual(1)
    expect(payload.images[imageKeys[0]!]).toMatch(/^data:image\/png;base64,/)
    expect(html).not.toContain("file://")
  })

  test("writeViewer runs standalone on an existing trace dir", async () => {
    const dir = tmp("frame-viewer-standalone-")
    // Hand-craft a minimal trace: index.jsonl + one PNG.
    writeFileSync(join(dir, "00001.png"), ONE_PX_PNG)
    const frame = {
      seq: 1,
      ts: 1747597815123,
      iso: "2026-05-18T23:30:15.123Z",
      hash: "xxh64:deadbeef",
      duplicate_of: null,
      bytes_in_since_last: 12,
      ansi_input_preview: "\\x1b[2Khello",
      buffer: { cols: 20, rows: 5, cursor: { row: 0, col: 5 } },
      duration_since_prev_ms: 0,
      render_ms: 1.5,
      png: "00001.png",
    }
    writeFileSync(join(dir, "index.jsonl"), JSON.stringify(frame) + "\n")

    const result = writeViewer(dir)
    expect(result.frameCount).toBe(1)
    expect(result.imageCount).toBe(1)
    expect(result.bytes).toBeGreaterThan(0)
    expect(result.viewerFile).toBe(join(dir, "viewer.html"))

    const html = readFileSync(result.viewerFile, "utf-8")
    expect(html).toContain('id="trace-data"')
    expect(html).toContain("data:image/png;base64,")
  })

  test("writeViewer tolerates a truncated final jsonl line", () => {
    const dir = tmp("frame-viewer-truncated-")
    const good = JSON.stringify({
      seq: 1,
      ts: 1,
      iso: "x",
      hash: "h",
      duplicate_of: null,
      bytes_in_since_last: 0,
      ansi_input_preview: "",
      buffer: { cols: 1, rows: 1, cursor: { row: 0, col: 0 } },
      duration_since_prev_ms: 0,
      render_ms: 0,
      png: null,
    })
    // Second line is a partial/crashed write.
    writeFileSync(join(dir, "index.jsonl"), good + "\n" + '{"seq":2,"ts":')

    const result = writeViewer(dir)
    expect(result.frameCount).toBe(1)
  })

  test("writeViewer throws when index.jsonl is missing", () => {
    const dir = tmp("frame-viewer-noindex-")
    expect(() => writeViewer(dir)).toThrow(/no index\.jsonl/)
  })

  test("silvery field is inlined when present on a frame", () => {
    const dir = tmp("frame-viewer-silvery-")
    const frame = {
      seq: 1,
      ts: 1,
      iso: "x",
      hash: "h",
      duplicate_of: null,
      bytes_in_since_last: 0,
      ansi_input_preview: "",
      buffer: { cols: 1, rows: 1, cursor: { row: 0, col: 0 } },
      duration_since_prev_ms: 0,
      render_ms: 0,
      png: null,
      silvery: { mountTree: ["Box", "Text"], dirtyFlags: 3 },
    }
    writeFileSync(join(dir, "index.jsonl"), JSON.stringify(frame) + "\n")
    const result = writeViewer(dir)
    const html = readFileSync(result.viewerFile, "utf-8")
    expect(html).toContain("mountTree")
    expect(html).toContain("dirtyFlags")
  })
})
