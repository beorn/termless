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
import {
  hasExtension,
  type HyperlinkExtension,
  type OscMetadataExtension,
  type PasteEncodingExtension,
  type MouseEncodingExtension,
  type SemanticMark,
} from "../../../src/terminal/types.ts"
import { createKittyBackend, isKittyAvailable } from "../src/backend.ts"
import * as hostKeyEncoding from "../../../src/terminal/key-encoding.ts"

// @failure Native parser rejections vanish at the bridge, or replay duplicates prior feed reports.
// @level l5
// @consumer Terminfo exact-code unhandled-sequence observations
test.skipIf(!isKittyAvailable())(
  "native parser error reports survive feeds through the existing OSC metadata reader",
  async () => {
    const backend = createKittyBackend({ cols: 20, rows: 5 })
    const metadata = backend as OscMetadataExtension
    const report = () => metadata.getUnhandledSequences?.() ?? []
    try {
      backend.feed(Buffer.from("\x1b]2;handled-control\x07\x1b[1mA"))
      expect(backend.getTitle()).toBe("handled-control")
      expect(backend.getCell(0, 0).bold).toBe(true)
      expect(report()).toEqual([])
      backend.feed(Buffer.from("\x1b]633;B\x07"))
      expect(report()).toEqual([{ kind: "osc", code: "633" }])
      backend.feed(Buffer.from("\x1b]2;second-control\x07"))
      expect(report()).toEqual([{ kind: "osc", code: "633" }])
      // A diagnostic listing several OSCs cannot decide one exact code.
      backend.feed(Buffer.from("\x1b]13;?\x07"))
      expect(report()).toEqual([{ kind: "osc", code: "633" }])
      backend.feed(Buffer.from("\x1b]440;bell.wav\x07"))
      expect(report()).toEqual([
        { kind: "osc", code: "633" },
        { kind: "osc", code: "440" },
      ])
      backend.feed(Buffer.from("\x1b]113\x07\x1b[9 p"))
      expect(report()).toEqual([
        { kind: "osc", code: "633" },
        { kind: "osc", code: "440" },
        { kind: "osc", code: "113" },
        { kind: "csi", code: " p" },
      ])
      const copied = report() as Array<{ kind: "osc" | "csi"; code: string }>
      copied[0]!.code = "changed-copy"
      expect(report()[0]).toEqual({ kind: "osc", code: "633" })
      backend.init({ cols: 20, rows: 5 })
      const actual = await vi.importActual<typeof childProcess>("node:child_process")
      vi.mocked(childProcess.execFileSync).mockImplementationOnce((file, args, options) => {
        const parsed = JSON.parse(String(actual.execFileSync(file, args, options))) as Record<string, unknown>
        parsed.parserErrors = [
          { version: "0.0.0", message: "Unknown OSC escape code: 113" },
          { version: "0.49.2", message: "unmatched diagnostic for OSC 113" },
        ]
        return JSON.stringify(parsed)
      })
      expect(report()).toEqual([])
    } finally {
      backend.destroy()
      vi.mocked(childProcess.execFileSync).mockClear()
    }
  },
)

// @failure Selecting Kitty's diagnostic parser variant changes the native state/reply path.
// @level l5
// @consumer Every Kitty feed, including already-decided Terminfo rows
test.skipIf(!isKittyAvailable())("diagnostic and ordinary parser arms retain the same real Screen state", () => {
  const bridgeDir = fileURLToPath(new URL("../build/", import.meta.url))
  const script = `
import bridge, json
data = b'\\x1b]2;parser-control\\x07\\x1b[1mA\\x1b[0m\\x1b]633;B\\x07\\x1b]59999;x\\x07\\x1b[9 pafter\\x1b[6n'
results = []
for arm in ['plain', 'diagnostic']:
    bridge.handle_command({'op':'init','cols':20,'rows':5})
    if arm == 'diagnostic':
        bridge.parse_bytes(bridge.screen, data)
    else:
        remaining = memoryview(data)
        while remaining:
            dest = bridge.screen.test_create_write_buffer()
            n = bridge.screen.test_commit_write_buffer(remaining, dest)
            remaining = remaining[n:]
            bridge.screen.test_parse_written_data()
    results.append(bridge.make_snapshot())
print(json.dumps(results))
`
  const configDir = mkdtempSync(join(tmpdir(), "termless-kitty-parser-config-"))
  try {
    const output = execFileSync(
      process.env.KITTY_BINARY ?? "kitty",
      ["+runpy", `import sys; sys.path.insert(0, ${JSON.stringify(bridgeDir)}); exec(${JSON.stringify(script)}, {})`],
      { encoding: "utf8", stdio: "pipe", timeout: 30_000, env: { ...process.env, KITTY_CONFIG_DIRECTORY: configDir } },
    )
    const [plain, diagnostic] = JSON.parse(output) as Array<Record<string, unknown>>
    const { parserErrors, ...diagnosticState } = diagnostic!
    expect(diagnosticState).toEqual(plain)
    expect(parserErrors).toEqual([
      { version: "0.49.2", message: "Ignoring OSC 633, use by Windows Terminal for VSCode actions" },
      { version: "0.49.2", message: "Unknown OSC escape code: 59999;x" },
      { version: "0.49.2", message: "Unknown CSI p sequence with start and end modifiers: '\0' ' '" },
    ])
  } finally {
    rmSync(configDir, { recursive: true, force: true })
    vi.mocked(childProcess.execFileSync).mockClear()
  }
})

// @failure Kitty's mouse extension must return its native Screen's reports, with held-button motion and wheel mapping,
// while a tracking-off Screen stays silent and encoding does not consume or deliver parser replies.
// @level l5
// @consumer Terminfo's five cell-coordinate mouse criteria; pixel and prompt-click paths remain unmeasured.
test.skipIf(!isKittyAvailable())(
  "native mouse reports follow tracking, buttons and actions without leaking replies",
  () => {
    const backend = createKittyBackend({ cols: 20, rows: 5 })
    const bytes = (value: string) => new TextEncoder().encode(value)
    const replies: string[] = []
    backend.onResponse = (value) => replies.push(new TextDecoder().decode(value))
    try {
      expect(hasExtension<MouseEncodingExtension>(backend, "mouse-encoding")).toBe(true)
      if (!hasExtension<MouseEncodingExtension>(backend, "mouse-encoding")) {
        throw new Error("Kitty mouse extension missing")
      }
      const press = { x: 4, y: 2, button: "left", action: "press" } as const
      expect(backend.encodeMouse(press)).toBeNull()
      backend.feed(bytes("\x1b[?1000;1006h\x1b[6n"))
      expect(backend.encodeMouse(press)).toEqual(bytes("\x1b[<0;5;3M"))
      expect(backend.encodeMouse({ ...press, action: "release" })).toEqual(bytes("\x1b[<0;5;3m"))
      expect(backend.encodeMouse({ ...press, button: "wheelUp" })).toEqual(bytes("\x1b[<64;5;3M"))
      expect(backend.encodeMouse({ ...press, action: "move" })).toBeNull()
      backend.feed(bytes("\x1b[?1002h"))
      expect(backend.encodeMouse({ ...press, action: "move" })).toEqual(bytes("\x1b[<32;5;3M"))
      expect(backend.encodeMouse({ ...press, button: "none", action: "move" })).toBeNull()
      expect(backend.encodeMouse({ ...press, shift: true, ctrl: true, alt: true })).toEqual(bytes("\x1b[<28;5;3M"))
      expect(() => backend.encodeMouse({ ...press, pixel: { x: 40, y: 24 } })).toThrow(/^mouse encoding unavailable:/)
      expect(replies).toEqual([])
      backend.getCursor()
      expect(replies).toEqual(["\x1b[1;1R"])
      backend.getCursor()
      expect(replies).toHaveLength(1)
      backend.reset()
      expect(backend.encodeMouse(press)).toBeNull()
    } finally {
      backend.destroy()
      vi.mocked(childProcess.execFileSync).mockClear()
    }
  },
)

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
    for (const mode of ["reverseVideo", "syncOutput", "mouseTracking"] as const) {
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
    const first = [
      [false, 0, 5],
      [true, "cmdline=printf é", 0, 5],
      [true, "", 0, 5],
    ]
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
        // Native diagnostics travel in the snapshot carrier; stderr remains reserved for unexpected failures.
        expect(result.stderr).toBe("")
        const outputs = result.stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>)
        expect(outputs).toHaveLength(mode === "stream" ? history.length + 1 : 1)
        for (const output of outputs) expect(output.error).toBeUndefined()
        expect(outputs.map((output) => output.parserErrors).filter((value) => value !== undefined)).toEqual([
          [{ version: "0.49.2", message: "Ignoring OSC 633, use by Windows Terminal for VSCode actions" }],
        ])
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
  "projects copied command marks at insertion coordinates across scroll, reset and replay",
  () => {
    const backend = createKittyBackend({ cols: 30, rows: 3 })
    const feed = (value: string) => backend.feed(new TextEncoder().encode(value))
    try {
      expect(hasExtension(backend, "semantic-command-end")).toBe(true)
      expect(backend.getSemanticMarks()).toEqual([])
      // A late snapshot cursor points after X, not where Kitty applied the native callback.
      const expected: SemanticMark[] = [{ type: "prompt", startRow: 0, startCol: 0 }]
      feed("\x1b]133;A\x07X")
      expect(backend.getSemanticMarks()).toEqual(expected)
      expect(hasExtension(backend, "semantic-marks")).toBe(true)
      feed("\x1b[2;3H\x1b]133;C;cmdline=echo hi\x07X")
      expected.push({ type: "output", startRow: 1, startCol: 2 })
      expect(backend.getSemanticMarks()).toEqual(expected)
      feed("\x1b]133;A\x07\x1b]133;A\x07")
      expected.push(...Array.from({ length: 2 }, () => ({ type: "prompt" as const, startRow: 1, startCol: 3 })))
      const retained = backend.getSemanticMarks()
      expect(retained).toEqual(expected)
      feed("\r\n".repeat(5))
      expect(backend.getCursor()).toMatchObject({ x: 0, y: 2 })
      expect(backend.getSemanticMarks()).toEqual(retained)
      Object.assign(retained[0]!, { startRow: 99, startCol: 99 })
      expect(backend.getSemanticMarks()).toEqual(expected)
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

/** Native completed OSC 7 state must survive replay and snapshot projection without URI decoding or OSC 633 emulation. */
test.skipIf(!isKittyAvailable())("reads literal native cwd across completed OSC 7 and lifecycle changes", () => {
  const backend = createKittyBackend({ cols: 30, rows: 3 })
  const other = createKittyBackend({ cols: 30, rows: 3 })
  const feed = (value: string | Uint8Array) => {
    backend.feed(typeof value === "string" ? new TextEncoder().encode(value) : value)
    return backend.getCwd()
  }
  // Native diagnostics have their own report carrier; reject every unexpected stderr byte.
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  try {
    expect(backend.getCwd()).toBeNull()
    expect(other.getCwd()).toBeNull()
    const literal = "file://host/tmp/\u96EA\\path;%20"
    expect(feed("\x1b]7;" + literal + "\x07")).toBe(literal)
    const retained = backend.getCwd()
    expect(feed("\x1b]7;file:///next")).toBe(literal)
    expect(feed("\x1b")).toBe(literal)
    expect(feed("\\")).toBe("file:///next")
    expect(retained).toBe(literal)
    expect(other.getCwd()).toBeNull()
    // The real OSC 7 positive control above distinguishes ignored 633 from a broken reader.
    expect(feed("\x1b]633;P;Cwd=/ignored-bel\x07")).toBe("file:///next")
    expect(feed("\x1b]633;P;Cwd=/ignored-st\x1b\\")).toBe("file:///next")
    expect(feed("\x1b]633;A\x07")).toBe("file:///next")
    expect(backend.getUnhandledSequences()).toEqual([
      { kind: "osc", code: "633" },
      { kind: "osc", code: "633" },
      { kind: "osc", code: "633" },
    ])
    expect(feed("\x1b]7;\x07")).toBeNull()
    expect(feed(new Uint8Array([27, 93, 55, 59, 47, 255, 254, 7]))).toBe("/\ufffd\ufffd")
    const long = "/" + "x".repeat(4096)
    expect(feed("\x1b]7;" + long + "\x1b\\")).toBe(long)
    expect(feed("\x1b]9;cwd-notification\x07\x1b]777;notify;cwd;body\x07")).toBe(long)
    expect(backend.getNotifications()).toEqual(["cwd-notification"])
    expect(backend.getOsc777Payloads()).toEqual(["notify;cwd;body"])
    expect(backend.getText().trim()).toBe("")
    backend.reset()
    expect(backend.getCwd()).toBeNull()
    expect(feed("\x1b]7;/before-init\x07")).toBe("/before-init")
    backend.init({ cols: 30, rows: 3 })
    expect(backend.getCwd()).toBeNull()
    other.feed(new TextEncoder().encode("\x1b]7;/other\x07"))
    expect(other.getCwd()).toBe("/other")
    expect(backend.getCwd()).toBeNull()
    expect(backend.getUnhandledSequences()).toEqual([])
    expect(stderr).not.toHaveBeenCalled()
  } finally {
    backend.destroy()
    other.destroy()
    stderr.mockRestore()
  }
})

// Existing subprocess seam models an old copied bridge, without a new product/test injection point.
test.each([
  { label: "missing", field: {} },
  { label: "number", field: { cwd: 7 } },
  { label: "object", field: { cwd: {} } },
])("rejects a $label cwd snapshot with a bridge-copy remedy", async ({ field }) => {
  const actual = await vi.importActual<typeof childProcess>("node:child_process")
  vi.stubEnv("KITTY_BINARY", process.execPath)
  const replay = vi.mocked(childProcess.execFileSync).mockReturnValueOnce(JSON.stringify({ cells: [], ...field }))
  const backend = createKittyBackend({ cols: 8, rows: 3 })
  try {
    expect(() => backend.getCwd()).toThrow(
      "Kitty bridge snapshot cwd must be a string or null; the bridge is stale or malformed. Copy packages/kitty/build/bridge.py from the same package version as src/backend.ts.",
    )
  } finally {
    backend.destroy()
    replay.mockReset()
    replay.mockImplementation(actual.execFileSync)
    vi.unstubAllEnvs()
  }
})

/**
 * @failure #32053: kitty dispatches OSC 9 to Window.desktop_notify, but the bridge recorded every OSC 9 as an
 * unreproduced callback and the backend declared no osc-metadata reader, so the Terminfo OSC 9 library criterion
 * could not observe the payloads kitty's own parser hands its notification path.
 * @consumer Terminfo extensions.notifications through osc-metadata
 */
test.skipIf(!isKittyAvailable())("reads OSC 9 payloads through the osc-metadata reader", () => {
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
    expect(backend.getCwd()).toBeNull()
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
  {
    history: [
      [false, 0, 0],
      [true, "changed", 0, 0],
      [null, "0"],
    ],
  },
  {
    history: [
      [false, 0, 0],
      [true, "cmd", 0, 0],
      [null, "17"],
    ],
  },
])("rejects lost or changed command callback history: $history", ({ history }) => {
  // The subprocess is mocked for corruption injection; discovery still requires an existing executable path.
  vi.stubEnv("KITTY_BINARY", process.execPath)
  const snapshot = {
    cells: [],
    cwd: null,
    cursor: { x: 0, y: 0, visible: true, style: "block" },
    title: "",
    modes: {},
    scrollback: { viewportOffset: 0, totalLines: 3, screenLines: 3 },
    text: "",
  }
  const replay = vi
    .mocked(childProcess.execFileSync)
    .mockReturnValueOnce(
      JSON.stringify({
        ...snapshot,
        cmdOutputMarkings: [
          [false, 0, 0],
          [true, "cmd", 0, 0],
          [null, "0"],
        ],
      }),
    )
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

// Native paste must stay outside persistent parser history and the ordinary response stream.
describe.skipIf(!isKittyAvailable())("native Kitty paste encoding", () => {
  test("uses Screen framing and verbatim bytes with native lifecycle", () => {
    const backend = createKittyBackend()
    const encode = (text: string) => (backend as typeof backend & PasteEncodingExtension).encodePaste(text)
    expect(() => encode("before-init")).toThrow(/not initialized/i)
    backend.init({ cols: 12, rows: 3 })
    try {
      expect(backend.capabilities.extensions.has("paste-encoding")).toBe(true)
      const received: string[] = []
      backend.onResponse = (bytes) => received.push(Buffer.from(bytes).toString())
      for (const enabled of [false, true]) {
        backend.feed(Buffer.from(enabled ? "\x1b[?2004h" : "\x1b[?2004l"))
        for (const text of ["", "hé😀", "a\r\nb\nc", "\x00\x01\x1b[201~tail"]) {
          expect(Buffer.from(encode(text)).toString()).toBe(enabled ? `\x1b[200~${text}\x1b[201~` : text)
        }
        expect(received).toEqual([])
        expect(backend.getMode("bracketedPaste")).toBe(enabled)
      }
      backend.reset()
      expect(Buffer.from(encode("reset")).toString()).toBe("reset")
      backend.init({ cols: 12, rows: 3 })
      expect(Buffer.from(encode("reinit")).toString()).toBe("reinit")
    } finally {
      backend.destroy()
    }
    expect(() => encode("after-destroy")).toThrow(/not initialized/i)
  })

  test.each([false, true])(
    "later ordinary replay omits temporary paste and delivers each queued reply once after failure=%s",
    async (fail) => {
      const actual = await vi.importActual<typeof childProcess>("node:child_process")
      const replay = vi.mocked(childProcess.execFileSync)
      replay.mockClear()
      const backend = createKittyBackend({ cols: 12, rows: 3 })
      const received: string[] = []
      backend.onResponse = (bytes) => received.push(Buffer.from(bytes).toString())
      backend.feed(Buffer.from("\x1b[6nX\x1b[6n"))
      if (fail) {
        replay.mockImplementationOnce((file, args, options) => {
          const hook =
            "original = bridge.handle_command\ndef fail_paste(cmd):\n    if cmd.get('op') == 'encode-paste':\n        raise RuntimeError('forced native paste failure')\n    return original(cmd)\nbridge.handle_command = fail_paste"
          return actual.execFileSync(
            file,
            [
              args![0]!,
              args![1]!.replace(
                "bridge.batch_main()",
                `exec(${JSON.stringify(hook)}, {"bridge": bridge}); bridge.batch_main()`,
              ),
            ],
            options,
          )
        })
      }
      try {
        const encode = () => (backend as typeof backend & PasteEncodingExtension).encodePaste("payload")
        if (fail) expect(encode).toThrow(/forced native paste failure/)
        else expect(Buffer.from(encode()).toString()).toBe("payload")
        expect(received).toEqual([])
        const encodedHistory = JSON.parse(String(replay.mock.calls[0]![2]!.input)) as {
          commands: Array<{ op: string }>
        }
        expect(encodedHistory.commands.at(-1)?.op).toBe("encode-paste")
        backend.getCursor()
        const ordinaryHistory = JSON.parse(String(replay.mock.calls[1]![2]!.input)) as {
          commands: Array<{ op: string }>
        }
        expect(ordinaryHistory.commands.some((command) => command.op === "encode-paste")).toBe(false)
        expect(received.join("")).toBe("\x1b[1;1R\x1b[1;2R")
        backend.getCursor()
        expect(replay).toHaveBeenCalledTimes(2)
        backend.feed(Buffer.from("\x1b[6n"))
        backend.getCursor()
        expect(received.join("")).toBe("\x1b[1;1R\x1b[1;2R\x1b[1;2R")
      } finally {
        backend.destroy()
        replay.mockClear()
      }
    },
  )

  test.each([false, true])("preserves the warm snapshot after encoding failure=%s", (fail) => {
    const replay = vi.mocked(childProcess.execFileSync)
    replay.mockClear()
    const backend = createKittyBackend({ cols: 12, rows: 3 })
    try {
      const cursor = backend.getCursor()
      const warnings = backend.getWarnings()
      if (fail) {
        replay.mockImplementationOnce(() => {
          throw new Error("forced cached encode failure")
        })
      }
      const encode = () => backend.encodePaste("cache")
      if (fail) expect(encode).toThrow(/forced cached encode failure/)
      else expect(Buffer.from(encode()).toString()).toBe("cache")
      expect(backend.getCursor()).toEqual(cursor)
      expect(backend.getWarnings()).toEqual(warnings)
      expect(replay).toHaveBeenCalledTimes(2)
    } finally {
      backend.destroy()
      replay.mockClear()
    }
  })

  test.each([undefined, null, 3, "!", "YQ"])("rejects missing or malformed pasteEncoding=%s", async (pasteEncoding) => {
    const actual = await vi.importActual<typeof childProcess>("node:child_process")
    const replay = vi.mocked(childProcess.execFileSync).mockImplementationOnce((file, args, options) => {
      const parsed = JSON.parse(String(actual.execFileSync(file, args, options))) as Record<string, unknown>
      delete parsed.pasteEncoding
      if (pasteEncoding !== undefined) parsed.pasteEncoding = pasteEncoding
      return JSON.stringify(parsed)
    })
    const backend = createKittyBackend({ cols: 12, rows: 3 })
    try {
      expect(() => (backend as typeof backend & PasteEncodingExtension).encodePaste("x")).toThrow(/pasteEncoding/)
    } finally {
      backend.destroy()
      replay.mockClear()
    }
  })

  test("bridge restores both output buffers on success, callback failure and cleanup failure", () => {
    const bridgeDir = fileURLToPath(new URL("../build/", import.meta.url))
    const script = `
import bridge, json, base64
results = []
for fault in ['none', 'callback', 'both']:
    bridge.handle_command({'op':'init','cols':12,'rows':3})
    bridge.parse_bytes(bridge.screen, b'\x1b[6n')
    before_response = bridge.callbacks.responses
    before_wtc = bridge.callbacks.wtcbuf
    if fault != 'none':
        original_write = bridge.callbacks.write
        def broken_write(data):
            original_write(data)
            raise RuntimeError('primary callback failure')
        bridge.callbacks.write = broken_write
    if fault == 'both':
        class BrokenCleanup(bridge.Callbacks):
            def __setattr__(self, name, value):
                if name == 'responses' and value == before_response:
                    raise RuntimeError('cleanup buffer failure')
                super().__setattr__(name, value)
        bridge.callbacks.__class__ = BrokenCleanup
    try:
        result = bridge.handle_command({'op':'encode-paste','data':base64.b64encode(b'native').decode()})
        results.append({'fault':fault,'encoding':base64.b64decode(result['pasteEncoding']).decode(),'responses':bridge.callbacks.responses.decode(),'wtc':bridge.callbacks.wtcbuf.decode()})
    except Exception as error:
        import traceback
        results.append({'fault':fault,'error':''.join(traceback.format_exception(error)),'responses':bridge.callbacks.responses.decode(),'wtc':bridge.callbacks.wtcbuf.decode()})
print(json.dumps(results))
`
    const configDir = mkdtempSync(join(tmpdir(), "termless-kitty-paste-config-"))
    let output: string
    try {
      output = execFileSync(
        process.env.KITTY_BINARY ?? "kitty",
        ["+runpy", `import sys; sys.path.insert(0, ${JSON.stringify(bridgeDir)}); exec(${JSON.stringify(script)}, {})`],
        { encoding: "utf8", timeout: 30_000, env: { ...process.env, KITTY_CONFIG_DIRECTORY: configDir } },
      )
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
    const results = JSON.parse(output) as Array<{
      fault: string
      encoding?: string
      error?: string
      responses: string
      wtc: string
    }>
    expect(results[0]).toEqual({ fault: "none", encoding: "native", responses: "\x1b[1;1R", wtc: "\x1b[1;1R" })
    expect(results[1]).toMatchObject({
      fault: "callback",
      error: expect.stringContaining("primary callback failure"),
      responses: "\x1b[1;1R",
      wtc: "\x1b[1;1R",
    })
    expect(results[2]?.error).toContain("primary callback failure")
    expect(results[2]?.error).toContain("cleanup buffer failure")
    expect(results[2]?.wtc).toBe("\x1b[1;1R")
  })
})

// Current native state and delegation cannot be proved by the legacy host encoder's default bytes.
test.skipIf(!isKittyAvailable())(
  "native keys follow per-call modes, flags and reset through the replay Screen",
  async () => {
    const actual = await vi.importActual<typeof childProcess>("node:child_process")
    const traces: Record<string, unknown>[] = []
    const hook = `
import base64, io, json, sys
import kitty.fast_data_types as native
original_encode = native.encode_key_for_tty
key_calls = []
def observed_encode(*args, **kwargs):
    names = ("key", "shifted_key", "alternate_key", "mods", "action", "key_encoding_flags", "text", "cursor_key_mode")
    fields = dict(key=0, shifted_key=0, alternate_key=0, mods=0, action=native.GLFW_PRESS, key_encoding_flags=0, text="", cursor_key_mode=False)
    fields.update(zip(names, args))
    fields.update(kwargs)
    current = sys.modules["bridge"].screen
    fields["nativePress"] = native.GLFW_PRESS
    fields["nativeMods"] = dict(shift=native.GLFW_MOD_SHIFT, ctrl=native.GLFW_MOD_CONTROL, alt=native.GLFW_MOD_ALT, super=native.GLFW_MOD_SUPER)
    fields["screenFlags"] = current.current_key_encoding_flags()
    fields["screenCursor"] = current.cursor_key_mode
    result = original_encode(*args, **kwargs)
    fields["nativeBytes"] = base64.b64encode(result.encode("utf-8")).decode("ascii")
    key_calls.append(fields)
    return result
native.encode_key_for_tty = observed_encode
import bridge
saved_stdout = sys.stdout
captured = io.StringIO()
sys.stdout = captured
try:
    bridge.batch_main()
finally:
    sys.stdout = saved_stdout
result = json.loads(captured.getvalue())
result["testNativeKeyCalls"] = key_calls
print(json.dumps(result))
`
    const replay = vi.mocked(childProcess.execFileSync).mockImplementation((file, args, options) => {
      if (args?.[0] !== "+runpy") return actual.execFileSync(file, args, options)
      const script = args[1]!
      expect(script).toContain("import bridge; bridge.batch_main()")
      const output = actual.execFileSync(
        file,
        ["+runpy", script.replace("import bridge; bridge.batch_main()", `exec(${JSON.stringify(hook)}, {})`)],
        options,
      )
      const parsed = JSON.parse(String(output)) as {
        error?: string
        traceback?: string
        testNativeKeyCalls: Record<string, unknown>[]
      }
      if (parsed.error) throw new Error(`${parsed.error}\n${parsed.traceback ?? ""}`)
      expect(parsed.testNativeKeyCalls).toHaveLength(1)
      traces.push(...parsed.testNativeKeyCalls)
      return output
    })
    const host = vi.spyOn(hostKeyEncoding, "encodeKeyToAnsi")
    const backend = createKittyBackend({ cols: 8, rows: 3 })
    const feed = (text: string) => backend.feed(new TextEncoder().encode(text))
    const bytes = (text: string) => new TextEncoder().encode(text)
    try {
      expect(hasExtension(backend, "key-encoding")).toBe(true)
      feed("\x1b[?1h")
      expect(backend.encodeKey({ key: "ArrowUp" })).toEqual(bytes("\x1bOA"))
      feed("\x1b[?1l")
      expect(backend.encodeKey({ key: "ArrowUp" })).toEqual(bytes("\x1b[A"))
      feed("\x1b[>1u")
      expect(backend.encodeKey({ key: "Escape" })).toEqual(bytes("\x1b[27u"))
      feed("\x1b[<u")
      expect(backend.encodeKey({ key: "Escape" })).toEqual(bytes("\x1b"))
      feed("\x1b[?1h\x1b[>1u")
      backend.reset()
      expect(backend.encodeKey({ key: "ArrowUp" })).toEqual(bytes("\x1b[A"))
      expect(backend.encodeKey({ key: "Escape" })).toEqual(bytes("\x1b"))
      expect(backend.encodeKey({ key: "🦊" })).toEqual(bytes("🦊"))
      expect(traces.at(-1)).toMatchObject({ key: 0x1f98a, text: "🦊" })
      expect(backend.encodeKey({ key: "Tab", shift: true })).toEqual(bytes("\x1b[Z"))
      const tabTrace = traces.at(-1)!
      expect(tabTrace.mods).toBe((tabTrace.nativeMods as Record<string, number>).shift)
      for (const descriptor of [
        { key: "i", ctrl: true },
        { key: "x", alt: true },
        { key: "x", super: true },
      ]) {
        const output = backend.encodeKey(descriptor)
        const trace = traces.at(-1)!
        const nativeMods = trace.nativeMods as Record<string, number>
        const modifier = descriptor.ctrl ? "ctrl" : descriptor.alt ? "alt" : "super"
        expect(trace.mods).toBe(nativeMods[modifier])
        expect(trace.key).toBe(descriptor.key.codePointAt(0))
        expect(trace.text).toBe("")
        expect(output).toEqual(new Uint8Array(Buffer.from(String(trace.nativeBytes), "base64")))
      }
      expect(backend.encodeKey({ key: "Control" })).toEqual(new Uint8Array())
      expect(traces.map((trace) => [trace.key_encoding_flags, trace.cursor_key_mode])).toEqual([
        [0, true],
        [0, false],
        [1, false],
        [0, false],
        [0, false],
        [0, false],
        [0, false],
        [0, false],
        [0, false],
        [0, false],
        [0, false],
        [0, false],
      ])
      for (const trace of traces) {
        expect(trace.key_encoding_flags).toBe(trace.screenFlags)
        expect(trace.cursor_key_mode).toBe(trace.screenCursor)
        expect(trace.action).toBe(trace.nativePress)
        expect(trace.shifted_key).toBe(0)
        expect(trace.alternate_key).toBe(0)
      }
      // Empty bytes are accepted here only after the real native encoder returned them.
      expect(traces.at(-1)?.nativeBytes).toBe("")
      expect(host).not.toHaveBeenCalled()
    } finally {
      backend.destroy()
      host.mockRestore()
      replay.mockImplementation(actual.execFileSync)
      replay.mockClear()
    }
  },
)

// Observe the public effects of private cache/log/reply state without adding a production inspection seam.
test("encoding leaves cached snapshots, mutation logs and pending reply ownership unchanged", async () => {
  const actual = await vi.importActual<typeof childProcess>("node:child_process")
  vi.stubEnv("KITTY_BINARY", process.execPath)
  const base = {
    cells: [],
    cwd: null,
    cursor: { x: 0, y: 0, visible: true, style: "block" },
    title: "",
    modes: {},
    scrollback: { viewportOffset: 0, totalLines: 3, screenLines: 3 },
    text: "",
  }
  const reply = Buffer.from("\x1b[0n").toString("base64")
  const replay = vi
    .mocked(childProcess.execFileSync)
    .mockReturnValueOnce(JSON.stringify(base))
    .mockReturnValueOnce(JSON.stringify({ ...base, cursor: { ...base.cursor, x: 7 }, encodedKey: "YQ==" }))
    .mockReturnValueOnce(JSON.stringify({ ...base, responses: reply, encodedKey: "YQ==" }))
    .mockReturnValueOnce(JSON.stringify({ ...base, responses: reply }))
    .mockReturnValueOnce(JSON.stringify({ ...base, responses: reply }))
  replay.mockClear()
  const backend = createKittyBackend({ cols: 8, rows: 3 })
  const replies: Uint8Array[] = []
  backend.onResponse = (bytes) => replies.push(bytes)
  try {
    expect(backend.getCursor().x).toBe(0)
    expect(backend.encodeKey({ key: "a" })).toEqual(new Uint8Array([97]))
    expect(backend.getCursor().x).toBe(0)
    expect(replay).toHaveBeenCalledTimes(2)
    backend.feed(new TextEncoder().encode("\x1b[5n"))
    expect(backend.encodeKey({ key: "a" })).toEqual(new Uint8Array([97]))
    expect(replies).toEqual([])
    backend.getCursor()
    backend.getCursor()
    expect(replies).toEqual([new TextEncoder().encode("\x1b[0n")])
    expect(replay).toHaveBeenCalledTimes(4)
    backend.feed(new Uint8Array([65]))
    backend.getCursor()
    expect(replies).toHaveLength(1)
    const logs = replay.mock.calls.map(([, , options]) => {
      return (JSON.parse(String((options as { input: unknown }).input)) as { commands: { op: string }[] }).commands
    })
    expect(logs.map((commands) => commands.filter((command) => command.op === "encode-key").length)).toEqual([
      0, 1, 1, 0, 0,
    ])
    expect(logs[1]?.slice(0, -1)).toEqual(logs[0])
    expect(logs[2]?.slice(0, -1)).toEqual(logs[3])
    expect(logs[4]?.slice(0, -1)).toEqual(logs[3])
  } finally {
    backend.destroy()
    replay.mockImplementation(actual.execFileSync)
    replay.mockClear()
    vi.unstubAllEnvs()
  }
})

test("invalid key descriptors fail before any subprocess and leave the next snapshot healthy", async () => {
  const actual = await vi.importActual<typeof childProcess>("node:child_process")
  vi.stubEnv("KITTY_BINARY", process.execPath)
  const replay = vi.mocked(childProcess.execFileSync)
  replay.mockClear()
  const backend = createKittyBackend({ cols: 8, rows: 3 })
  try {
    for (const descriptor of [
      { key: "UnknownKey" },
      { key: "" },
      { key: "hello" },
      { key: "🦊a" },
      { key: "F13" },
      { key: "a", shift: true },
      { key: "🦊", shift: true },
    ]) {
      expect(() => backend.encodeKey(descriptor)).toThrow(/kitty.*(?:key|scalar|Shift)/i)
    }
    expect(replay).not.toHaveBeenCalled()
    replay.mockReturnValueOnce(
      JSON.stringify({
        cells: [],
        cwd: null,
        cursor: { x: 0, y: 0, visible: true, style: "block" },
        title: "",
        modes: {},
        scrollback: { viewportOffset: 0, totalLines: 3, screenLines: 3 },
        text: "",
      }),
    )
    expect(backend.getCursor().x).toBe(0)
    const commands = (
      JSON.parse(String((replay.mock.calls[0]?.[2] as { input: unknown }).input)) as { commands: unknown[] }
    ).commands
    expect(commands).toEqual([{ op: "init", cols: 8, rows: 3, scrollbackLimit: 1000 }])
  } finally {
    backend.destroy()
    replay.mockImplementation(actual.execFileSync)
    replay.mockClear()
    vi.unstubAllEnvs()
  }
})

test.skipIf(!isKittyAvailable())("a native encoder exception leaves the next ordinary replay healthy", async () => {
  const actual = await vi.importActual<typeof childProcess>("node:child_process")
  const hook = `
import kitty.fast_data_types as native
def failed_encode(*args, **kwargs):
    raise RuntimeError("injected native key encoding failure")
native.encode_key_for_tty = failed_encode
import bridge
bridge.batch_main()
`
  const replay = vi.mocked(childProcess.execFileSync).mockImplementationOnce((file, args, options) => {
    expect(args?.[0]).toBe("+runpy")
    expect(args?.[1]).toContain("import bridge; bridge.batch_main()")
    return actual.execFileSync(
      file,
      ["+runpy", args![1]!.replace("import bridge; bridge.batch_main()", `exec(${JSON.stringify(hook)}, {})`)],
      options,
    )
  })
  const backend = createKittyBackend({ cols: 8, rows: 3 })
  const replies: Uint8Array[] = []
  backend.onResponse = (bytes) => replies.push(bytes)
  try {
    backend.feed(new TextEncoder().encode("A\x1b[5n"))
    expect(() => backend.encodeKey({ key: "a" })).toThrow(/injected native key encoding failure/)
    expect(replies).toEqual([])
    expect(backend.getCell(0, 0).char).toBe("A")
    expect(backend.getCursor()).toMatchObject({ x: 1, y: 0 })
    expect(replies).toEqual([new TextEncoder().encode("\x1b[0n")])
  } finally {
    backend.destroy()
    replay.mockImplementation(actual.execFileSync)
    replay.mockClear()
  }
})

test.each([
  { label: "missing", field: {} },
  { label: "null", field: { encodedKey: null } },
  { label: "non-string", field: { encodedKey: 1 } },
  { label: "non-base64", field: { encodedKey: "%%%" } },
  { label: "noncanonical base64", field: { encodedKey: "YQ" } },
])("rejects $label encodedKey instead of substituting bytes", async ({ field }) => {
  const actual = await vi.importActual<typeof childProcess>("node:child_process")
  vi.stubEnv("KITTY_BINARY", process.execPath)
  const base = {
    cells: [],
    cwd: null,
    cursor: { x: 0, y: 0, visible: true, style: "block" },
    title: "",
    modes: {},
    scrollback: { viewportOffset: 0, totalLines: 3, screenLines: 3 },
    text: "",
  }
  const replay = vi
    .mocked(childProcess.execFileSync)
    .mockReturnValueOnce(JSON.stringify({ ...base, ...field }))
    .mockReturnValueOnce(JSON.stringify(base))
  const backend = createKittyBackend({ cols: 8, rows: 3 })
  try {
    expect(() => backend.encodeKey({ key: "a" })).toThrow(/encodedKey|base64/)
    expect(backend.getCursor().x).toBe(0)
  } finally {
    backend.destroy()
    replay.mockImplementation(actual.execFileSync)
    replay.mockClear()
    vi.unstubAllEnvs()
  }
})
