/**
 * @failure A reproduced kitty Window callback raises inside the headless bridge; kitty prints the trace and replays on, so
 * a reply the callback never sent reads as the engine's silence.
 * Stored cell hyperlinks also must survive the CPU-cell snapshot and public factory observer without leaking their ID.
 * @level l5
 * @consumer Terminfo Kitty colour-query criteria and their DA1-sentinel negatives
 * @testonly none
 */
import { describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { hasExtension, type HyperlinkExtension } from "../../../src/terminal/types.ts"
import { createKittyBackend, isKittyAvailable } from "../src/backend.ts"

// Existing URI/callback tests never observe the distinct stored SGR 58/59 color.
test.skipIf(!isKittyAvailable())("underline colors (requires installed Kitty or KITTY_BINARY)", () => {
  const backend = createKittyBackend({ cols: 6, rows: 1 })
  try {
    backend.feed(new TextEncoder().encode("\x1b[4;38;5;5mC\x1b[58;5;5mI\x1b[58;2;255;0;128mR\x1b[59mD\x1b[0m"))
    const palette5 = { r: 128, g: 0, b: 128 }
    expect(backend.getCell(0, 0)).toMatchObject({ char: "C", fg: palette5, underlineColor: null })
    expect(backend.getCell(0, 1)).toMatchObject({ char: "I", underline: "single", underlineColor: palette5 })
    expect(backend.getCell(0, 2).underlineColor).toEqual({ r: 255, g: 0, b: 128 })
    expect(backend.getCell(0, 3).underlineColor).toBeNull()
    expect(
      backend
        .getLine(0)
        .slice(0, 4)
        .map((cell) => cell.underlineColor),
    ).toEqual([null, palette5, { r: 255, g: 0, b: 128 }, null])
  } finally {
    backend.destroy()
  }
})

describe.skipIf(!isKittyAvailable())("kitty bridge callbacks", () => {
  // OSC 4 set and OSC 104 reset run kitty's own Window.set_color_table_color, which ends in Window.refresh.
  test("a colour table change replays without a callback error", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    try {
      backend.feed(new TextEncoder().encode("\x1b]4;1;#abcdef\x1b\\\x1b]104;1\x1b\\"))
      expect(() => backend.getCursor()).not.toThrow()
    } finally {
      backend.destroy()
    }
  })
})

// The factory is the owner of engine URI extraction and the public observer. Existing callback tests never read cells.
test.skipIf(!isKittyAvailable())(
  "stored hyperlinks survive mutations (requires installed Kitty or KITTY_BINARY)",
  () => {
    const backend = createKittyBackend({ cols: 20, rows: 3 })
    const feed = (value: string): void => backend.feed(new TextEncoder().encode(value))
    const uri = "https://example.com:8443/a:b"
    try {
      feed(`A\x1b]8;;${uri}\x1b\\LINK\x1b]8;;\x1b\\Z`)
      expect(backend.getCell(0, 1).hyperlink).toBe(uri)
      expect(hasExtension(backend, "hyperlinks")).toBe(true)
      if (!hasExtension<HyperlinkExtension>(backend, "hyperlinks")) throw new Error("Kitty has no hyperlink observer")
      const saved = backend.getCell(0, 1)
      for (const col of [1, 2, 3, 4]) {
        expect(backend.getHyperlinkAt(0, col)).toBe(uri)
        expect(backend.getRow(0)[col]?.hyperlink).toBe(uri)
      }
      expect(backend.getHyperlinkAt(0, 0)).toBeNull()
      expect(backend.getHyperlinkAt(0, 5)).toBeNull()

      const other = "mailto:person@example.com:service"
      feed(`\r\nA\x1b]8;id=explicit;${other}\x1b\\LINK\x1b]8;;\x1b\\Z`)
      expect(backend.getHyperlinkAt(1, 1)).toBe(other)
      expect(backend.getRows()[1]?.[1]?.hyperlink).toBe(other)
      expect(backend.getHyperlinkAt(1, 5)).toBeNull()
      feed("\x1b[?1049hA")
      expect(backend.getCell(0, 0).char).toBe("A")
      expect(backend.getHyperlinkAt(0, 1)).toBeNull()
      feed("\x1b[?1049l")
      expect(backend.getHyperlinkAt(0, 1)).toBe(uri)
      backend.resize(22, 4)
      expect(backend.getHyperlinkAt(0, 1)).toBe(uri)
      feed("\r\n\r\n\r\n")
      expect(backend.getCell(0, 1).hyperlink).toBe(other)
      expect(backend.getHyperlinkAt(0, 1)).toBe(other)
      backend.scrollViewport(-1)
      // Preserve Kitty's existing getCell origin: live Screen rows, even while scrolled.
      expect(backend.getHyperlinkAt(0, 1)).toBe(backend.getCell(0, 1).hyperlink)
      backend.reset()
      expect(backend.getHyperlinkAt(0, 1)).toBeNull()
      expect(saved.hyperlink).toBe(uri)
    } finally {
      backend.destroy()
    }
  },
)

// Invalid carriers cannot occur through OSC 8; inject only at the actual CPU-cell -> snapshot boundary, retaining the
// real Screen and make_snapshot. This independently guards missing metadata and accidental id:URI exposure.
test.skipIf(!isKittyAvailable())("snapshot carrier validation (requires installed Kitty or KITTY_BINARY)", () => {
  const bridgeDir = fileURLToPath(new URL("../build/", import.meta.url))
  const configDir = mkdtempSync(join(tmpdir(), "termless-kitty-carriers-"))
  let result: string
  try {
    result = execFileSync(
      process.env.KITTY_BINARY ?? "kitty",
      [
        "+runpy",
        `exec(${JSON.stringify(`
import base64, json, sys
sys.path.insert(0, ${JSON.stringify(bridgeDir)})
import bridge
sys.excepthook = sys.__excepthook__
bridge.handle_command({"op": "init", "cols": 3, "rows": 1})
uri = "https://example.com:8443/a:b"
bridge.handle_command({"op": "feed", "data": base64.b64encode(("\\x1b]8;id=explicit;" + uri + "\\x1b\\\\L\\x1b]8;;\\x1b\\\\Z").encode()).decode()})
raw = bridge.screen.cpu_cells(0)
actual = bridge.make_snapshot()["cells"][0]
real_screen = bridge.screen
class CarrierScreen:
    def __getattr__(self, key):
        return getattr(real_screen, key)
    def cpu_cells(self, row):
        cells = [dict(cell) for cell in real_screen.cpu_cells(row)]
        if missing:
            del cells[0]["hyperlink"]
        else:
            cells[0]["hyperlink"] = carrier
        return cells
bridge.screen = CarrierScreen()
observed = []
for carrier in [None, "id:", ":" + uri, "id:" + uri, 5, {}, "missing-separator"]:
    missing = False
    try:
        observed.append({"value": bridge.make_snapshot()["cells"][0][0]["hyperlink"]})
    except (KeyError, TypeError, ValueError) as error:
        observed.append({"error": type(error).__name__})
missing = True
try:
    bridge.make_snapshot()
    observed.append({"missing": "accepted"})
except KeyError:
    observed.append({"missing": "rejected"})
print(json.dumps({"raw": [cell["hyperlink"] for cell in raw], "actual": [cell.get("hyperlink", "ABSENT") for cell in actual], "observed": observed}))
`)}, {})`,
      ],
      { encoding: "utf-8", timeout: 30_000, env: { ...process.env, KITTY_CONFIG_DIRECTORY: configDir } },
    )
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
  expect(JSON.parse(result)).toEqual({
    raw: ["explicit:https://example.com:8443/a:b", null, null],
    actual: ["https://example.com:8443/a:b", null, null],
    observed: [
      { value: null },
      { value: "" },
      { value: "https://example.com:8443/a:b" },
      { value: "https://example.com:8443/a:b" },
      { error: "TypeError" },
      { error: "TypeError" },
      { error: "ValueError" },
      { missing: "rejected" },
    ],
  })
})
