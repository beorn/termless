/**
 * @failure A reproduced kitty Window callback raises inside the headless bridge; kitty prints the trace and replays on, so
 * a reply the callback never sent reads as the engine's silence.
 * Stored cell hyperlinks also must survive the CPU-cell snapshot and public factory observer without leaking their ID.
 * @level l5
 * @consumer Terminfo Kitty colour-query criteria and their DA1-sentinel negatives
 * @testonly none
 */
import { describe, expect, test, vi } from "vitest"
import * as childProcess from "node:child_process"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { hasExtension, type HyperlinkExtension, type OscMetadataExtension } from "../../../src/terminal/types.ts"
import { createKittyBackend, isKittyAvailable } from "../src/backend.ts"

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})

// Native journeys cover valid layouts. These resource faults must reject native mode reads before any pointer
// access, while ordinary snapshot consumers keep working; use the real bridge/runtime, not a fabricated snapshot.
test.skipIf(!isKittyAvailable()).each([
  { fault: "missing manifest", cause: "missing" },
  { fault: "malformed manifest", cause: "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)" },
  { fault: "stale receipt", cause: "stale" },
  {
    fault: "Kitty version",
    edit: (layout: Record<string, unknown>) => {
      layout.kittyVersion = "0.0.0"
    },
    cause: "Kitty version: expected '0.0.0'; observed '0.49.2'",
  },
  {
    fault: "source revision",
    edit: (layout: Record<string, unknown>) => {
      layout.sourceCommit = "unreviewed"
    },
    cause: "Kitty source revision: expected 'unreviewed'; observed 'b2cb871254fbdac19a085188813c8dfb258b95cd'",
  },
  {
    fault: "native module identity",
    edit: (layout: Record<string, unknown>) => {
      layout.nativeModuleSha256 = "unreviewed"
    },
    cause:
      "native module sha256: expected 'unreviewed'; observed '6f28bbff8e8276d076957a718b9c1db21d1a42a7592890fab5171ee31db99619'",
  },
  {
    fault: "Python build flags",
    edit: (layout: Record<string, unknown>) => {
      ;(layout.python as Record<string, unknown>).pyGilDisabled = 1
    },
    cause: "python.pyGilDisabled manifest: expected 0; observed 1",
  },
  {
    fault: "Screen size",
    edit: (layout: Record<string, unknown>) => {
      ;(layout.screen as Record<string, unknown>).size = 3889
    },
    cause: "Screen basicsize: expected 3889; observed 3888",
  },
  {
    fault: "field bounds",
    edit: (layout: Record<string, unknown>) => {
      const screen = layout.screen as Record<string, Record<string, unknown>>
      screen.syncOutput!.offset = 3888
    },
    cause: "syncOutput.offset: 3888 is outside Screen size 3888",
  },
])("keeps generic reads healthy and reports unavailable native modes: $fault", async ({ fault, edit, cause }) => {
  const bridgeDir = dirname(fileURLToPath(new URL("../build/bridge.py", import.meta.url)))
  const fixtureDir = mkdtempSync(join(tmpdir(), "termless-kitty-layout-fault-"))
  const layoutPath = join(fixtureDir, "native-mode-layout.json")
  const receiptPath = join(fixtureDir, "native-mode-layout.receipt.json")
  copyFileSync(join(bridgeDir, "bridge.py"), join(fixtureDir, "bridge.py"))
  const layout = JSON.parse(readFileSync(join(bridgeDir, "native-mode-layout.json"), "utf8")) as Record<string, unknown>
  edit?.(layout)
  const rawLayout = fault === "malformed manifest" ? "{" : JSON.stringify(layout)
  if (fault !== "missing manifest") writeFileSync(layoutPath, rawLayout)
  const receipt = JSON.parse(readFileSync(join(bridgeDir, "native-mode-layout.receipt.json"), "utf8")) as Record<
    string,
    unknown
  >
  const actualLayoutSha = createHash("sha256").update(rawLayout).digest("hex")
  if (fault !== "stale receipt") receipt.sha256 = actualLayoutSha
  writeFileSync(receiptPath, JSON.stringify(receipt))
  const actual = await vi.importActual<typeof childProcess>("node:child_process")
  const replay = vi.mocked(childProcess.execFileSync).mockImplementationOnce((file, args, options) => {
    expect(args?.[0]).toBe("+runpy")
    const script = args![1]!.replace(JSON.stringify(bridgeDir), JSON.stringify(fixtureDir))
    expect(script).not.toBe(args![1])
    // Import ctypes first so the hook observes only target reads. Any invalid layout reaching from_address fails
    // the whole real snapshot, which the generic-read assertions below would reject for an independent reason.
    const hook =
      "def reject_native_read(event, args):\n    if event == 'ctypes.cdata':\n        raise AssertionError('Fault fixture reached native pointer access')\nsys.addaudithook(reject_native_read)"
    return actual.execFileSync(
      file,
      [
        "+runpy",
        script.replace("bridge.batch_main()", `import ctypes; exec(${JSON.stringify(hook)}); bridge.batch_main()`),
      ],
      options,
    )
  })
  const backend = createKittyBackend({ cols: 10, rows: 3 })
  try {
    backend.feed(new TextEncoder().encode("A"))
    expect(backend.getCell(0, 0).char).toBe("A")
    expect(backend.getCursor()).toMatchObject({ x: 1, y: 0 })
    expect(backend.getMode("colorSchemeReporting")).toBe(false)
    const reason =
      cause === "missing"
        ? `[Errno 2] No such file or directory: '${layoutPath}'`
        : cause === "stale"
          ? `manifest sha256: expected '${receipt.sha256}'; observed '${actualLayoutSha}'`
          : cause
    const diagnostic = `KITTY_NATIVE_STATE_UNAVAILABLE: Kitty native modes at ${layoutPath} (receipt ${receiptPath}): ${reason}`
    for (const mode of ["reverseVideo", "syncOutput"] as const) {
      expect(() => backend.getMode(mode)).toThrow(new Error(diagnostic))
    }
    expect(backend.getCell(0, 0).char).toBe("A")
    expect(replay).toHaveBeenCalledTimes(1)
  } finally {
    backend.destroy()
    replay.mockClear()
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})

// Exercise the full native callback protocol, including starts that the public command-end reader does not expose.
// Other callback cases miss dropped command marks, raw status coercion and feed/reset/replay losses or duplicates.
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
        const result = spawnSync(
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
        expect(result.error).toBeUndefined()
        expect(result.status).toBe(0)
        // The OSC633 negative deliberately reaches Kitty's unsupported parser path. Assert its diagnostic without
        // forwarding it to the root harness as unexpected test output; every other stderr byte remains a failure.
        expect(result.stderr).toMatch(
          /^\[\d+\.\d+\] \[PARSE ERROR\] Ignoring OSC 633, use by Windows Terminal for VSCode actions\n$/,
        )
        const outputs = result.stdout
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

// Private bridge coverage cannot catch an absent public reader, cache-object leaks, fabricated coordinates,
// or reset clearing callback history that native replay retains. This tests the public projection/lifetime contract.
test.skipIf(!isKittyAvailable())(
  "projects copied command ends through the public reader across reset and replay",
  () => {
    const backend = createKittyBackend({ cols: 30, rows: 3 })
    const feed = (value: string) => backend.feed(new TextEncoder().encode(value))
    try {
      expect(hasExtension(backend, "semantic-command-end")).toBe(true)
      expect(hasExtension(backend, "semantic-marks")).toBe(false)
      expect(backend.getSemanticMarks()).toEqual([])
      feed("\x1b]133;A\x07\x1b]133;C;cmdline=echo hi\x07")
      expect(backend.getSemanticMarks()).toEqual([])
      const expected: { type: "command-end"; rawStatus: string }[] = []
      for (const status of ["0", "17", "", "not-a-code", "-2", "0", "0"]) {
        const before = backend.getSemanticMarks()
        feed(`\x1b]133;D;${status}\x07`)
        expected.push({ type: "command-end", rawStatus: status })
        const after = backend.getSemanticMarks()
        expect(after).toHaveLength(before.length + 1)
        expect(after.slice(0, -1)).toEqual(before)
        expect(after).toEqual(expected)
        expect(backend.getSemanticMarks()).toEqual(expected)
        const end = after.at(-1)!
        if (end.type !== "command-end") throw new Error("Expected a command-end entry")
        Object.assign(end, { rawStatus: "mutated", startRow: 99 })
        expect(backend.getSemanticMarks()).toEqual(expected)
      }
      backend.reset()
      expect(backend.getSemanticMarks()).toEqual(expected)
      feed("\x1b]133;D;17\x07")
      expect(backend.getSemanticMarks()).toEqual([...expected, { type: "command-end", rawStatus: "17" }])
      backend.init({ cols: 30, rows: 3 })
      expect(backend.getSemanticMarks()).toEqual([])
    } finally {
      backend.destroy()
    }
  },
)

/**
 * @failure #32053: kitty dispatches OSC 9 to Window.desktop_notify, but the bridge recorded every OSC 9 as an
 * unreproduced callback and the backend declared no osc-metadata reader, so the Terminfo OSC 9 library criterion
 * could not observe the payloads kitty's own parser hands its notification path.
 * @consumer Terminfo extensions.notifications through osc-metadata (no cwd reader: OSC 7 stays missing evidence)
 */
test.skipIf(!isKittyAvailable())("reads OSC 9 payloads through the osc-metadata reader, with no cwd reader", () => {
  const backend = createKittyBackend({ cols: 30, rows: 3 })
  const feed = (value: string) => {
    backend.feed(new TextEncoder().encode(value))
    backend.getCursor()
  }
  const desktopWarnings = () =>
    backend
      .getWarnings()
      .filter((warning) => warning.code === "UNREPRODUCED_CALLBACK" && warning.message === "desktop_notify")
  try {
    expect(hasExtension<OscMetadataExtension>(backend, "osc-metadata")).toBe(true)
    // A declared extension with no getCwd is missing evidence for OSC 7, never "no working directory".
    expect("getCwd" in backend).toBe(false)
    expect(backend.getNotifications()).toEqual([])
    feed("\x1b]9;terminfo-notification-A\x07")
    const first = backend.getNotifications()
    expect(first).toEqual(["terminfo-notification-A"])
    feed("\x1b]9;terminfo-notification-B\x1b\\")
    expect(backend.getNotifications()).toEqual(["terminfo-notification-A", "terminfo-notification-B"])
    // A returned list is a copy: mutating it cannot rewrite the engine's history.
    ;(first as string[]).push("mutated")
    expect(backend.getNotifications()).toEqual(["terminfo-notification-A", "terminfo-notification-B"])
    expect(desktopWarnings()).toEqual([])
    // OSC 9;4 is kitty's progress path and OSC 777 has its own reader: neither is an OSC 9 payload.
    feed("\x1b]9;4;1;50\x07\x1b]777;notify;title;body\x07")
    expect(backend.getNotifications()).toEqual(["terminfo-notification-A", "terminfo-notification-B"])
    expect(desktopWarnings()).toEqual([])
    backend.init({ cols: 30, rows: 3 })
    expect(backend.getNotifications()).toEqual([])
  } finally {
    backend.destroy()
  }
})

/**
 * @failure #32053: kitty's parser dispatches every OSC 777 to Window.desktop_notify, but the bridge dropped them, so
 * the Terminfo OSC 777 library criterion had no reader for the payloads kitty receives.
 * @consumer Terminfo extensions.osc777-notify through osc-metadata getOsc777Payloads
 */
test.skipIf(!isKittyAvailable())("reads every OSC 777 payload verbatim through the osc-metadata reader", () => {
  const backend = createKittyBackend({ cols: 30, rows: 3 })
  const feed = (value: string) => {
    backend.feed(new TextEncoder().encode(value))
    backend.getCursor()
  }
  try {
    expect(hasExtension<OscMetadataExtension>(backend, "osc-metadata")).toBe(true)
    feed("\x1b]777;notify;terminfo-title;terminfo-body\x07")
    // The payload reaches a reader rather than an unreproduced-callback warning.
    expect(backend.getWarnings().filter((warning) => warning.message === "desktop_notify")).toEqual([])
    const first = backend.getOsc777Payloads()
    expect(first).toEqual(["notify;terminfo-title;terminfo-body"])
    // Not a notify form: the reader passes it on verbatim; callers filter "notify;" themselves.
    feed("\x1b]777;preexec\x1b\\")
    expect(backend.getOsc777Payloads()).toEqual(["notify;terminfo-title;terminfo-body", "preexec"])
    ;(first as string[]).push("mutated")
    expect(backend.getOsc777Payloads()).toEqual(["notify;terminfo-title;terminfo-body", "preexec"])
    expect(backend.getNotifications()).toEqual([])
    expect(backend.getWarnings().filter((warning) => warning.message === "desktop_notify")).toEqual([])
    backend.init({ cols: 30, rows: 3 })
    expect(backend.getOsc777Payloads()).toEqual([])
  } finally {
    backend.destroy()
  }
})

/**
 * @failure #32271: kitty stores every OSC 9;4 report in Window.progress, but the bridge reported the path unreproduced,
 * so the Terminfo progress criterion had no reader for what kitty stores.
 * @consumer Terminfo extensions.osc9-progress through osc-metadata getProgress
 */
test.skipIf(!isKittyAvailable())(
  "reads kitty's stored OSC 9;4 progress verbatim, null until kitty accepts a report",
  () => {
    const backend = createKittyBackend({ cols: 30, rows: 3 })
    const feed = (value: string) => {
      backend.feed(new TextEncoder().encode(value))
      backend.getCursor()
    }
    const desktopWarnings = () => backend.getWarnings().filter((warning) => warning.message === "desktop_notify")
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    try {
      expect(backend.getProgress()).toBeNull()
      // kitty logs a malformed report and returns before Progress.update (window.py:1389-1391): still never reported.
      feed("\x1b]9;4;x\x07")
      expect(backend.getProgress()).toBeNull()
      feed("\x1b]9;4;1;37\x07")
      const first = backend.getProgress()
      expect(first).toEqual({ state: 1, value: 37 })
      // A returned report is a copy: mutating it cannot rewrite the engine's state.
      first!.value = 99
      expect(backend.getProgress()).toEqual({ state: 1, value: 37 })
      // kitty stores percent 0 for error and indeterminate (progress.py:34-39); the reader never restores the input.
      feed("\x1b]9;4;2;64\x07")
      expect(backend.getProgress()).toEqual({ state: 2, value: 0 })
      feed("\x1b]9;4;3\x1b\\")
      expect(backend.getProgress()).toEqual({ state: 3, value: 0 })
      // A state-0 report is a report, never null.
      feed("\x1b]9;4;0\x07")
      expect(backend.getProgress()).toEqual({ state: 0, value: 0 })
      expect(desktopWarnings()).toEqual([])
      backend.init({ cols: 30, rows: 3 })
      expect(backend.getProgress()).toBeNull()
      expect(stderr.mock.calls.length).toBeGreaterThan(0)
      for (const [chunk] of stderr.mock.calls) {
        expect(String(chunk)).toMatch(/^\[\d+\.\d+\] Ignoring malformed OSC 9;4 progress report: '4;x'\n$/)
      }
    } finally {
      backend.destroy()
      stderr.mockRestore()
    }
  },
)

// Native replay is consistent, so private subprocess tests miss the adapter accepting lost/rewritten history.
test.each([
  { history: undefined },
  { history: [] },
  { history: [[false], [true, "changed"], [null, "0"]] },
  { history: [[false], [true, "cmd"], [null, "17"]] },
])("rejects lost or changed command callback history: $history", ({ history }) => {
  // The subprocess is mocked for corruption injection; discovery still requires an existing executable path.
  vi.stubEnv("KITTY_BINARY", process.execPath)
  const snapshot = {
    cells: [],
    cursor: { x: 0, y: 0, visible: true, style: "block" },
    title: "",
    modes: {},
    scrollback: { viewportOffset: 0, totalLines: 3, screenLines: 3 },
    text: "",
  }
  const replay = vi
    .mocked(childProcess.execFileSync)
    .mockReturnValueOnce(JSON.stringify({ ...snapshot, cmdOutputMarkings: [[false], [true, "cmd"], [null, "0"]] }))
    .mockReturnValueOnce(JSON.stringify({ ...snapshot, cmdOutputMarkings: history }))
  const backend = createKittyBackend({ cols: 30, rows: 3 })
  try {
    backend.getCursor()
    backend.feed(new Uint8Array([65]))
    expect(() => backend.getCursor()).toThrow(/earlier command callback.*batch replay/)
  } finally {
    backend.destroy()
    replay.mockClear()
    vi.unstubAllEnvs()
  }
})

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
  // TARGETS uses a different Clipboard method from OSC 52 data reads; the existing clipboard journey never lists types.
  // Exercise Kitty's actual parser/request manager while any attempt to query the display clipboard fails loudly.
  test("answers OSC 5522 TARGETS from the headless clipboard without GLFW", ({ onTestFinished }) => {
    const bridgeDir = fileURLToPath(new URL("../build/", import.meta.url))
    const configDir = mkdtempSync(join(tmpdir(), "termless-kitty-targets-"))
    onTestFinished(() => rmSync(configDir, { recursive: true, force: true }))
    const feed = (text: string) => ({ op: "feed", data: Buffer.from(text).toString("base64") })
    const targets = feed("\x1b]5522;type=read;Lg==\x07")
    const noDisplay = "def forbid_display_clipboard(*args):\n    raise AssertionError('TARGETS reached GLFW clipboard')"
    const result = spawnSync(
      process.env.KITTY_BINARY ?? "kitty",
      [
        "+runpy",
        `import sys; sys.path.insert(0, ${JSON.stringify(bridgeDir)}); import bridge; import kitty.clipboard as clipboard; exec(${JSON.stringify(noDisplay)}); clipboard.get_clipboard_mime = forbid_display_clipboard; bridge.batch_main()`,
      ],
      {
        input: JSON.stringify({
          commands: [
            { op: "init", cols: 30, rows: 3 },
            targets,
            feed(`\x1b]52;c;${btoa("clipboard text")}\x07`),
            targets,
          ],
        }),
        encoding: "utf-8",
        timeout: 30_000,
        env: { ...process.env, KITTY_CONFIG_DIRECTORY: configDir, DISPLAY: "", WAYLAND_DISPLAY: "" },
      },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    const snapshot = JSON.parse(result.stdout) as { error?: string; traceback?: string; responses?: string }
    expect(snapshot.error, snapshot.traceback).toBeUndefined()
    const response = Buffer.from(snapshot.responses ?? "", "base64").toString()
    const prefix = "\x1b]5522;type=read:status="
    const end = "\x1b\\"
    expect(response).toBe(
      `${prefix}OK${end}${prefix}DATA:mime=Lg==${end}${prefix}DONE${end}` +
        `${prefix}OK${end}${prefix}DATA:mime=Lg==;${btoa("text/plain\n")}${end}${prefix}DONE${end}`,
    )
  })

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

// The actual Cursor reader has no conceal accessor; neither live nor synthetic blanks report measured false.
test.skipIf(!isKittyAvailable())(
  "cell and row readers retain unreported conceal (requires installed Kitty or KITTY_BINARY)",
  () => {
    const backend = createKittyBackend({ cols: 5, rows: 2 })
    try {
      backend.feed(new TextEncoder().encode("\x1b[1;8mX\x1b[0mY"))
      for (const cell of [backend.getCell(0, 0), backend.getRow(0)[0], backend.getRows()[0]?.[0]]) {
        expect(cell).toMatchObject({ char: "X", bold: true, hidden: null })
      }
      for (const cell of [backend.getCell(0, 1), backend.getRow(0)[1], backend.getRows()[0]?.[1]]) {
        expect(cell).toMatchObject({ char: "Y", bold: false, hidden: null })
      }
      for (const cell of [
        backend.getCell(1, 0),
        backend.getRow(1)[0],
        backend.getRows()[1]?.[0],
        backend.getCell(2, 0),
        backend.getRow(2)[0],
      ]) {
        expect(cell).toMatchObject({ bold: false, hidden: null })
      }
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
