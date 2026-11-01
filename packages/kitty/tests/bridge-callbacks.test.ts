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

// The factory does not expose this private recording yet. Exercise the actual bridge protocol: the existing eight
// callback cases miss dropped command marks, raw status coercion and losses/duplicates at feed/reset/replay boundaries.
test.skipIf(!isKittyAvailable())(
  "retains native command callback arguments exactly once across feed/reset/replay",
  () => {
    const bridgeDir = fileURLToPath(new URL("../build/", import.meta.url))
    const configDir = mkdtempSync(join(tmpdir(), "termless-kitty-command-marks-"))
    const feed = (text: string) => ({ op: "feed", data: Buffer.from(text).toString("base64") })
    const negative = feed("plain\x1b]133;A;k=s\x07\x1b]633;A\x07")
    const commands = [
      { op: "init", cols: 30, rows: 3 },
      negative,
      feed("\x1b]133;A\x07\x1b]133;C;cmdline=printf é\x07\x1b]133;C\x07"),
      feed("\x1b]133;D\x07\x1b]133;D;0\x07\x1b]133;D;not-a-code\x07\x1b]133;D;-2\x07"),
      { op: "reset" },
      feed("\x1b]133;D;0\x07"),
      { op: "snapshot" },
    ]
    const first = [[false], [true, "cmdline=printf é"], [true, ""]]
    const statuses = [
      [null, ""],
      [null, "0"],
      [null, "not-a-code"],
      [null, "-2"],
    ]
    const expected = [...first, ...statuses, [null, "0"]]
    try {
      for (const mode of ["stream", "batch", "batch", "fresh"] as const) {
        const history = mode === "fresh" ? [commands[0], negative, { op: "snapshot" }] : commands
        const result = execFileSync(
          process.env.KITTY_BINARY ?? "kitty",
          [
            "+runpy",
            `import sys; sys.path.insert(0, ${JSON.stringify(bridgeDir)}); import bridge; bridge.${mode === "stream" ? "main" : "batch_main"}()`,
          ],
          {
            input:
              mode === "stream"
                ? history.map((command) => JSON.stringify(command)).join("\n") + "\n"
                : JSON.stringify({ commands: history }),
            encoding: "utf-8",
            timeout: 30_000,
            env: { ...process.env, KITTY_CONFIG_DIRECTORY: configDir },
          },
        )
        const outputs = result
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>)
        expect(outputs).toHaveLength(mode === "stream" ? history.length + 1 : 1)
        for (const output of outputs) expect(output.error).toBeUndefined()
        if (mode === "stream") {
          expect(outputs.shift()).toEqual({ ready: true })
          expect(outputs[1]!.cmdOutputMarkings).toBeUndefined()
          expect(outputs[2]!.cmdOutputMarkings).toEqual(first)
          expect(outputs[3]!.cmdOutputMarkings).toEqual(statuses)
          expect(outputs[5]!.cmdOutputMarkings).toEqual([[null, "0"]])
          expect(outputs[6]!.cmdOutputMarkings).toBeUndefined()
        } else if (mode === "fresh") {
          expect(outputs[0]!.cmdOutputMarkings).toBeUndefined()
        } else {
          expect(outputs[0]!.cmdOutputMarkings).toEqual(expected)
        }
      }
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  },
)

// Counter-only coverage misses the absolute-buffer contract: retained content must have the same row in every reader.
test.skipIf(!isKittyAvailable())("reads retained rows across alternate screens, resize and eviction", () => {
  const backend = createKittyBackend({ cols: 80, rows: 24, scrollbackLimit: 24 })
  const encode = (text: string) => new TextEncoder().encode(text)
  const markers = Array.from(
    { length: 48 },
    (_, row) => `S${String(row).padStart(2, "0")}${row === 1 || row === 25 ? "界e\u0301" : ""}`,
  )
  const uri = "https://example.test:8443/retained:row"
  const lineText = (row: number) =>
    backend
      .getLine(row)
      .map((cell) => cell.char)
      .join("")
      .trimEnd()
  try {
    backend.feed(
      encode(
        markers
          .map((marker, row) =>
            row === 0 || row === 24
              ? `\x1b[1;38;2;17;34;51m\x1b]8;;${uri}\x1b\\${marker}\x1b]8;;\x1b\\\x1b[0m`
              : marker,
          )
          .join("\r\n"),
      ),
    )
    expect(backend.getScrollback()).toMatchObject({ totalLines: 48, screenLines: 24 })
    expect(lineText(0)).toBe("S00")
    expect(
      backend.getLines().map((line) =>
        line
          .map((cell) => cell.char)
          .join("")
          .trimEnd(),
      ),
    ).toEqual(markers)
    for (const row of [0, 1, 23, 24, 25, 47]) {
      expect(lineText(row)).toBe(markers[row])
      expect(backend.getTextRange(row, 0, row, 3)).toBe(markers[row]!.slice(0, 3))
    }
    expect(backend.getTextRange(23, 0, 24, 3)).toBe("S23\nS24")
    for (const row of [1, 25]) {
      expect(backend.getCell(row, 3)).toMatchObject({ char: "界", wide: true })
      expect(backend.getCell(row, 5).char).toBe("e\u0301")
    }
    expect(
      backend
        .getText()
        .split("\n")
        .map((line) => line.trimEnd()),
    ).toEqual(markers)
    for (const row of [0, 24]) {
      const styled = { char: "S", bold: true, fg: { r: 17, g: 34, b: 51 }, hyperlink: uri }
      expect(backend.getCell(row, 0)).toMatchObject(styled)
      expect(backend.getLine(row)[0]).toMatchObject(styled)
      expect(backend.getLines()[row]?.[0]).toMatchObject(styled)
    }
    backend.scrollViewport(-5)
    expect(backend.getScrollback().viewportTop).toBe(19)
    expect(lineText(0)).toBe("S00")
    expect(lineText(12)).toBe("S12")
    backend.scrollViewport(5)
    backend.feed(encode("\x1b[?1049h\x1b[HALT"))
    expect(backend.getMode("altScreen")).toBe(true)
    expect(backend.getScrollback()).toMatchObject({ totalLines: 24, screenLines: 24, viewportTop: 0 })
    expect(backend.getLines()).toHaveLength(24)
    expect(lineText(0)).toBe("ALT")
    expect(backend.getText()).not.toContain("S00")
    backend.feed(encode("\x1b[?1049l"))
    expect(backend.getMode("altScreen")).toBe(false)
    expect(backend.getLines()).toHaveLength(48)
    expect(lineText(0)).toBe("S00")
    expect(lineText(12)).toBe("S12")
    backend.resize(60, 24)
    expect(backend.getLines()).toHaveLength(48)
    expect(backend.getLines().every((line) => line.length === 60)).toBe(true)
    expect(
      backend
        .getText()
        .split("\n")
        .map((line) => line.trimEnd()),
    ).toEqual(markers)
    backend.feed(encode("\r\nS48"))
    expect(backend.getScrollback()).toMatchObject({ totalLines: 48, screenLines: 24 })
    expect(lineText(0)).toBe(markers[1])
    expect(lineText(47)).toBe("S48")
  } finally {
    backend.destroy()
  }
})

// Existing snapshot tests never distinguish an absolute buffer row from distance to the bottom.
test.skipIf(!isKittyAvailable())("reports absolute viewport rows through scrolling", () => {
  const backend = createKittyBackend({ cols: 20, rows: 3 })
  try {
    expect(backend.getScrollback()).toEqual({
      viewportTop: 0,
      totalRows: 3,
      screenRows: 3,
      viewportOffset: 0,
      totalLines: 3,
      screenLines: 3,
    })
    backend.feed(new TextEncoder().encode("0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7"))
    const expectPosition = (top: number): void => {
      expect(backend.getScrollback()).toEqual({
        viewportTop: top,
        totalRows: 8,
        screenRows: 3,
        viewportOffset: top,
        totalLines: 8,
        screenLines: 3,
      })
    }
    expectPosition(5)
    backend.scrollViewport(-2)
    expectPosition(3)
    backend.scrollViewport(-100)
    expectPosition(0)
    backend.scrollViewport(100)
    expectPosition(5)
  } finally {
    backend.destroy()
  }
})

// Existing URI/callback tests never observe the distinct stored SGR 58/59 color.
test.skipIf(!isKittyAvailable())("underline colors (requires installed Kitty or KITTY_BINARY)", () => {
  const backend = createKittyBackend({ cols: 6, rows: 1 })
  try {
    backend.feed(new TextEncoder().encode("\x1b[4;38;5;5mC\x1b[58;5;5mI\x1b[58;2;255;0;128mR\x1b[59mD\x1b[0m"))
    // Kitty's own ColorProfile default for color5 (kitty/options/types.py defaults.color5 = #cb1ed1)
    const palette5 = { r: 203, g: 30, b: 209 }
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
  // Capability detection must reach kitty's real reply handler; the colour/viewport cases never send OSC99.
  test("answers OSC99 capability queries while retaining unreproduced display warnings", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    let response = ""
    backend.onResponse = (bytes) => {
      response += new TextDecoder().decode(bytes)
    }
    try {
      for (const [index, terminator] of ["\x07", "\x1b\\"].entries()) {
        const nonce = `termless-notify-${index}`
        response = ""
        backend.feed(new TextEncoder().encode(`\x1b]99;i=${nonce}:p=?;${terminator}`))
        backend.getCursor()
        const frame = new RegExp(`\\x1b\\]99;i=${nonce}:p=\\?;([^\\x07\\x1b]*)(?:\\x07|\\x1b\\\\)`).exec(response)
        expect(
          frame?.[1]?.split(":").some((field) => field.startsWith("p=") && field.slice(2).split(",").includes("title")),
        ).toBe(true)
        expect(backend.getWarnings().some((warning) => warning.message === "desktop_notify")).toBe(false)
      }
      backend.feed(new TextEncoder().encode("\x1b]99;i=unreproduced-display:p=title;test\x1b\\"))
      backend.getCursor()
      expect(backend.getWarnings()).toContainEqual({
        code: "UNREPRODUCED_CALLBACK",
        message: "desktop_notify",
        backend: "kitty",
      })
    } finally {
      backend.destroy()
    }
  })

  /**
   * @failure #32091: every OSC 52 callback was unreproduced, so kitty's clipboard cells measured nothing.
   * @consumer Terminfo extensions.osc52-write through getClipboardState
   */
  test("commits an OSC 52 write through kitty's own clipboard_control and answers a read with the supplied permission", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    let response = ""
    backend.onResponse = (bytes) => {
      response += new TextDecoder().decode(bytes)
    }
    try {
      const payload = btoa("termless-osc52")
      backend.feed(new TextEncoder().encode(`\x1b]52;c;${payload}\x07`))
      // kitty's default is read-clipboard-ask (a human prompt); the headless window supplies the read permission and
      // reports the option it runs under, so a consumer records that host input from the engine.
      expect(backend.getClipboardState?.()).toEqual({
        writes: [{ selector: "c", payload, text: "termless-osc52" }],
        control: ["write-clipboard", "write-primary", "read-clipboard", "read-primary"],
      })
      backend.feed(new TextEncoder().encode("\x1b]52;c;?\x07"))
      backend.getCursor()
      expect(response).toBe(`\x1b]52;c;${payload}\x1b\\`)
      expect(backend.getWarnings()).toEqual([])
    } finally {
      backend.destroy()
    }
  })

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

  test("resolves indexed cell colors through screen.color_profile after OSC 4 and XTPUSHCOLORS/XTPOPCOLORS (#31735)", () => {
    const backend = createKittyBackend({ cols: 10, rows: 2 })
    try {
      backend.feed(new TextEncoder().encode("\x1b]4;1;rgb:12/34/56\x1b\\\x1b[31;48;5;1;4;58;5;1mA\x1b[0m"))
      expect(backend.getCell(0, 0)).toMatchObject({
        char: "A",
        fg: { r: 0x12, g: 0x34, b: 0x56 },
        bg: { r: 0x12, g: 0x34, b: 0x56 },
        underline: "single",
        underlineColor: { r: 0x12, g: 0x34, b: 0x56 },
      })
      backend.feed(new TextEncoder().encode("\x1b[#P\x1b]4;1;rgb:aa/bb/cc\x1b\\"))
      expect(backend.getCell(0, 0).fg).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
      backend.feed(new TextEncoder().encode("\x1b[#Q"))
      expect(backend.getCell(0, 0).fg).toEqual({ r: 0x12, g: 0x34, b: 0x56 })
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
      const firstScreenRow = backend.getScrollback().totalLines - backend.getScrollback().screenLines
      expect(backend.getCell(firstScreenRow, 1).hyperlink).toBe(other)
      expect(backend.getHyperlinkAt(firstScreenRow, 1)).toBe(other)
      expect(backend.getCell(0, 1).hyperlink).toBe(uri)
      backend.scrollViewport(-1)
      // Absolute rows and their hyperlinks stay fixed when only the viewport moves.
      expect(backend.getHyperlinkAt(firstScreenRow, 1)).toBe(other)
      expect(backend.getHyperlinkAt(0, 1)).toBe(uri)
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
