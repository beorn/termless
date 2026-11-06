/**
 * Window-op probe responses — libvterm backend.
 *
 * neovim's libvterm (compiled to WASM via Emscripten) is a pure cell-grid
 * emulator with no native window pixel concept, so we synthesize CSI 14t
 * (text-area pixel size) and CSI 18t (text-area cell count) responses
 * from configured grid × cell metrics. silvery's `resolveMouseOption()`
 * uses both to enable SGR-Pixels (1016) mouse coordinate mode.
 *
 * Skipped when the WASM module isn't built locally — the intercept lives
 * in the JS wrapper and is independent of the WASM, but the backend
 * can't initialize without it.
 */

import { describe, test, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { createLibvtermBackend } from "../src/backend.ts"
import { initLibvterm, loadedLibvtermWasm, type LibvtermModule } from "../src/wasm-bindings.ts"
import {
  hasExtension,
  type OscMetadataExtension,
  type AdapterSourcesExtension,
  type TerminalBackend,
} from "../../../src/terminal/types.ts"

const CSI_4_TEXT_AREA_PIXELS_RE = /^\x1b\[4;(\d+);(\d+)t$/
const CSI_8_TEXT_AREA_CELLS_RE = /^\x1b\[8;(\d+);(\d+)t$/

// Probe WASM availability synchronously up-front so we can use describe.skip.
// initLibvterm() is async, so we kick it off and await before the suite.
// A "loaded" module can still be incomplete when the WASM artifact isn't built;
// verify the exported accessors required by the TypeScript wrapper before running.
let wasmModule: LibvtermModule | null = null
let skipReason = ""
try {
  const candidate = await initLibvterm()
  if (
    candidate &&
    typeof (candidate as { _malloc?: unknown })._malloc === "function" &&
    typeof (candidate as { setValue?: unknown }).setValue === "function" &&
    typeof (candidate as { getValue?: unknown }).getValue === "function"
  ) {
    wasmModule = candidate
  } else {
    skipReason = "WASM module loaded but missing required exports (likely not built)"
  }
} catch (e) {
  skipReason = e instanceof Error ? e.message.split("\n")[0]! : String(e)
}

const describeWasm = wasmModule ? describe : describe.skip

// Case 1: existing metadata tests retain delivery payloads, but do not witness the
// library's negative state report. Only its unrecognised callback may add numbers.
test("unhandled OSC numbers follow the native observer lifetime without recording handled title", async () => {
  const module = await initLibvterm()
  const backend = createLibvtermBackend(undefined, module)
  const other = createLibvtermBackend(undefined, module)
  const options = { cols: 20, rows: 2 }
  backend.init(options)
  other.init(options)
  const read = (value = backend) => {
    expect(hasExtension<OscMetadataExtension>(value, "osc-metadata")).toBe(true)
    return value.getUnhandledSequences?.()
  }
  const feed = (text: string) => backend.feed(new TextEncoder().encode(text))
  try {
    feed("\x1b]2;handled control\x07")
    expect(backend.getTitle()).toBe("handled control")
    // Before this member existed the public interface supplied no report.
    expect(read() ?? []).toEqual([])
    feed("\x1b]133;A;private payload")
    expect(read()).toEqual([{ kind: "osc", code: "133" }])
    feed(";more payload\x07\x1b]633;B\x1b\\\x1b]999;unknown\x07")
    expect(read()).toEqual([
      { kind: "osc", code: "133" },
      { kind: "osc", code: "633" },
      { kind: "osc", code: "999" },
    ])
    const copy = read() as { kind: "osc"; code: string }[]
    copy[0]!.code = "changed copy"
    expect(read()?.[0]).toEqual({ kind: "osc", code: "133" })
    expect(read(other)).toEqual([])
    backend.reset()
    expect(read()).toEqual([])
    feed("\x1b]133;C\x07")
    expect(read()).toEqual([{ kind: "osc", code: "133" }])
    backend.init(options)
    expect(read()).toEqual([])
    backend.destroy()
    expect(() => read()).toThrow("not initialized")
  } finally {
    backend.destroy()
    other.destroy()
  }
})

// R1: OSC-only coverage cannot detect absent CSI/APC fallbacks. Exercise the
// actual engine and its handled control, without a parser mock or extra seam.
test("native CSI rejection reports preserve normalized codes and exclude applied DECSCUSR", async () => {
  const backend = createLibvtermBackend(undefined, await initLibvterm())
  backend.init({ cols: 20, rows: 2 })
  const feed = (text: string) => backend.feed(new TextEncoder().encode(text))
  try {
    feed("\x1b[6 q")
    expect(backend.getCursor().style).toBe("beam")
    expect(backend.getUnhandledSequences?.()).toEqual([])
    for (const [sequence, code] of [
      ["\x1b[9 p", " 9p"],
      ["\x1b[?99999z", "?99999z"],
      ["\x1b[1;:3$z", "$1;0:3z"],
    ]) {
      const before = backend.getUnhandledSequences?.() ?? []
      feed(sequence!)
      expect(backend.getUnhandledSequences?.()).toEqual([...before, { kind: "csi", code }])
    }
    const before = backend.getUnhandledSequences?.()
    // Upstream drops # and * before its public fallback; absence is no report.
    feed("\x1b[#P\x1b[#Q\x1b[2*x")
    expect(backend.getUnhandledSequences?.()).toEqual(before)
  } finally {
    backend.destroy()
  }
})

test("native APC reports keep only the initial byte, ordered with CSI and OSC, and clear on reset", async () => {
  const backend = createLibvtermBackend(undefined, await initLibvterm())
  backend.init({ cols: 20, rows: 2 })
  const feed = (text: string) => backend.feed(new TextEncoder().encode(text))
  try {
    feed("\x1b]2;handled control\x07")
    expect(backend.getTitle()).toBe("handled control")
    expect(backend.getUnhandledSequences?.()).toEqual([])
    feed("\x1b_Ga=t;private payload")
    expect(backend.getUnhandledSequences?.()).toEqual([{ kind: "apc", code: "G" }])
    feed("more payload\x1b\\\x1b]999;unknown\x07\x1b[9 p\x1b_Zmade-up\x1b\\")
    // libvterm has no handled APC: made-up APC is rejected too.
    expect(backend.getUnhandledSequences?.()).toEqual([
      { kind: "apc", code: "G" },
      { kind: "osc", code: "999" },
      { kind: "csi", code: " 9p" },
      { kind: "apc", code: "Z" },
    ])
    backend.reset()
    expect(backend.getUnhandledSequences?.()).toEqual([])
  } finally {
    backend.destroy()
  }
})

// The old suite observes application-cursor state and window properties, but
// cannot catch missing keypad state or a declared-only reflow capability.
test("reports native keypad transitions and the instance's actual reflow setting", async () => {
  const backend = createLibvtermBackend(undefined, await initLibvterm())
  backend.init({ cols: 8, rows: 2 })
  try {
    const responses: Uint8Array[] = []
    backend.onResponse = (bytes) => responses.push(bytes)
    expect(backend.getMode("applicationKeypad")).toBe(false)
    backend.feed(new TextEncoder().encode("\x1b="))
    expect(backend.getMode("applicationKeypad")).toBe(true)
    backend.feed(new TextEncoder().encode("\x1b>"))
    expect(backend.getMode("applicationKeypad")).toBe(false)
    expect(backend.getReflowState?.()).toEqual({ enabled: true })
    expect(responses).toEqual([])
  } finally {
    backend.destroy()
  }
})

// Real retained rows distinguish a callback-backed reader from the previous
// screen-only count/read methods. This also pins the public absolute-row seam.
test("retains real history cells, evicts oldest at the limit and handles engine ED3", async () => {
  const backend = createLibvtermBackend(undefined, await initLibvterm())
  backend.init({ cols: 8, rows: 2, scrollbackLimit: 1 })
  const feed = (text: string) => backend.feed(new TextEncoder().encode(text))
  try {
    feed("zero\r\none\r\ntwo")
    expect(backend.getScrollback().totalRows).toBe(3)
    expect(backend.getText().split("\n")).toEqual(["zero", "one", "two"])
    expect(backend.getCell(0, 0).char).toBe("z")
    expect(
      backend
        .getRow(1)
        .slice(0, 3)
        .map((cell) => cell.char)
        .join(""),
    ).toBe("one")
    expect(backend.getRows()).toHaveLength(3)
    feed("\r\nthree")
    expect(backend.getText().split("\n")).toEqual(["one", "two", "three"])
    feed("\x1b[3J")
    expect(backend.getScrollback().totalRows).toBe(2)
    expect(backend.getText().split("\n")).toEqual(["two", "three"])
  } finally {
    backend.destroy()
  }
})

// AC1: the existing mode-only assertions cannot detect a stateless input encoder.
// The real backend must return native application-cursor input, without replies.
test("application cursor input follows native state without producing replies", async () => {
  const module = await initLibvterm()
  const backend = createLibvtermBackend(undefined, module)
  const isolated = createLibvtermBackend(undefined, module)
  backend.init({ cols: 8, rows: 2 })
  isolated.init({ cols: 8, rows: 2 })
  try {
    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    const feed = (sequence: string) => backend.feed(new TextEncoder().encode(sequence))
    const up = (target = backend) => new TextDecoder().decode(target.encodeKey({ key: "ArrowUp" }))
    expect(backend.getMode("applicationCursor")).toBe(false)
    expect(up()).toBe("\x1b[A")
    feed("\x1b[?1")
    expect(backend.getMode("applicationCursor")).toBe(false)
    expect(up()).toBe("\x1b[A")
    feed("h")
    expect(backend.getMode("applicationCursor")).toBe(true)
    expect(up()).toBe("\x1bOA")
    expect(isolated.getMode("applicationCursor")).toBe(false)
    expect(up(isolated)).toBe("\x1b[A")
    expect(responses).toEqual([])
    feed("\x1b[?1l")
    expect(backend.getMode("applicationCursor")).toBe(false)
    expect(up()).toBe("\x1b[A")
    for (const reset of ["\x1b[!p", "\x1bc"]) {
      feed("\x1b[?1h")
      expect(backend.getMode("applicationCursor")).toBe(true)
      feed(reset)
      expect(backend.getMode("applicationCursor")).toBe(false)
      expect(up()).toBe("\x1b[A")
    }
    expect(responses).toEqual([])
  } finally {
    backend.destroy()
    isolated.destroy()
  }
})

// Native reset does not invoke sb_clear. The previous reset implementation
// cleared property strings explicitly; sharing its owner must preserve both
// contracts rather than silently clearing history with those strings.
test("reset clears title and icon while retained history survives and alternate output adds none", async () => {
  const backend = createLibvtermBackend(undefined, await initLibvterm())
  backend.init({ cols: 8, rows: 2 })
  const feed = (text: string) => backend.feed(new TextEncoder().encode(text))
  try {
    feed("zero\r\none\r\ntwo\x1b]0;label\x07")
    expect(backend.getScrollback().totalRows).toBe(3)
    backend.reset()
    expect(backend.getTitle()).toBe("")
    expect(backend.getIconLabel?.()).toBe("")
    expect(backend.getScrollback().totalRows).toBe(3)
    expect(backend.getText().split("\n")[0]).toBe("zero")
    feed("\x1b[?1049hA\r\nB\r\nC\r\nD\x1b[?1049l")
    expect(backend.getScrollback().totalRows).toBe(3)
    expect(backend.getText().split("\n")[0]).toBe("zero")
  } finally {
    backend.destroy()
  }
})

test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 0x80000000])(
  "rejects an invalid history limit %s before native integer conversion",
  async (scrollbackLimit) => {
    const mod = await initLibvterm()
    expect(() => createLibvtermBackend({ scrollbackLimit }, mod)).toThrow(/scrollbackLimit.*integer/i)
    const backend = createLibvtermBackend(undefined, mod)
    expect(() => backend.init({ cols: 8, rows: 2, scrollbackLimit })).toThrow(/scrollbackLimit.*integer/i)
  },
)

test("a zero history limit retains no rows", async () => {
  const backend = createLibvtermBackend(undefined, await initLibvterm())
  backend.init({ cols: 8, rows: 2, scrollbackLimit: 0 })
  try {
    backend.feed(new TextEncoder().encode("zero\r\none\r\ntwo"))
    expect(backend.getScrollback().totalRows).toBe(2)
    expect(backend.getText().split("\n")).toEqual(["one", "two"])
  } finally {
    backend.destroy()
  }
})

// A width-0 pad wedges a synchronous WASM resize indefinitely. A child owns
// that failure so its 10s deadline can kill it; a promise timeout cannot.
test("native history pop completes when padding and truncating wide rows", () => {
  const backendUrl = new URL("../src/backend.ts", import.meta.url).href
  const moduleUrl = new URL("../src/wasm-bindings.ts", import.meta.url).href
  const script = `
    import { createLibvtermBackend } from ${JSON.stringify(backendUrl)};
    import { initLibvterm } from ${JSON.stringify(moduleUrl)};
    const mod = await initLibvterm();
    const results = [];
    for (const [initialCols, finalCols, text] of [[4,8,"ABC"],[8,4,"ABCDE"],[8,4,"ABC世"]]) {
      const term = createLibvtermBackend(undefined, mod);
      term.init({cols:initialCols,rows:2});
      term.feed(new TextEncoder().encode(text + "\\r\\nx\\r\\ny"));
      const retained = term.getScrollback().totalRows - 2;
      // libvterm asks sb_popline for OLD columns. Change width first,
      // retaining the original stored width, then grow height separately.
      term.resize(finalCols, 2);
      const afterWidth = {
        retained:term.getScrollback().totalRows - 2,
        storedCols:term.getRow(0).length,
      };
      term.resize(finalCols, 4);
      results.push({retained, afterWidth, cells:term.getRow(0), rows:term.getScrollback().totalRows});
      term.destroy();
    }
    process.stdout.write(JSON.stringify(results));
  `
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    timeout: 10_000,
    encoding: "utf8",
  })
  expect(child.error, child.stderr).toBeUndefined()
  expect(child.status, child.stderr).toBe(0)
  const results = JSON.parse(child.stdout) as {
    retained: number
    afterWidth: { retained: number; storedCols: number }
    cells: ReturnType<TerminalBackend["getRow"]>
    rows: number
  }[]
  expect(results).toHaveLength(3)
  const initialWidths = [4, 8, 8]
  const finalWidths = [8, 4, 4]
  for (const [index, result] of results.entries()) {
    expect(result.retained).toBe(1)
    expect(result.afterWidth).toEqual({ retained: 1, storedCols: initialWidths[index] })
    expect(result.rows).toBe(4)
    expect(result.cells).toHaveLength(finalWidths[index]!)
    expect(
      result.cells
        .slice(0, 3)
        .map((cell) => cell.char)
        .join(""),
    ).toBe("ABC")
  }
  expect(results[1]!.cells[3]!.char).toBe("D")
  for (const blank of [...results[0]!.cells.slice(3), results[2]!.cells[3]!]) {
    expect(blank).toMatchObject({
      char: "",
      fg: null,
      bg: null,
      bold: false,
      italic: false,
      underline: false,
      wide: false,
      continuation: false,
    })
  }
}, 15_000)

// The WASM32 row-array size overflows for this otherwise representable limit.
// It exercises the real failed-storage callback without exhausting host RAM
// or adding an allocator-injection API solely for the test.
test("history storage failure remains loud on the next read", async () => {
  const backend = createLibvtermBackend(undefined, await initLibvterm())
  backend.init({ cols: 8, rows: 2, scrollbackLimit: 0x7fffffff })
  try {
    expect(() => backend.feed(new TextEncoder().encode("zero\r\none\r\ntwo"))).toThrow(
      /allocation failure; history or properties were lost/i,
    )
    expect(() => backend.getScrollback()).toThrow(/allocation failure.*history/i)
    expect(() => backend.getText()).toThrow(/allocation failure.*history/i)
  } finally {
    backend.destroy()
  }
})

// Observe the real WASM memory through Emscripten's existing instantiation
// option. No production allocator hook/export is introduced for this test.
test("re-observing frees retained native rows before reusing the context", async () => {
  const bytes = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../wasm/libvterm.wasm", import.meta.url)),
  )
  const wasm = new WebAssembly.Module(bytes)
  let memory: WebAssembly.Memory | undefined
  const factory = (await import("../wasm/libvterm.js")).default as unknown as (options: {
    instantiateWasm: (
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) => WebAssembly.Exports
  }) => Promise<Record<string, (...args: number[]) => number>>
  const raw = await factory({
    instantiateWasm(imports, receive) {
      const instance = new WebAssembly.Instance(wasm, imports)
      memory = instance.exports.memory as WebAssembly.Memory
      receive(instance, wasm)
      return instance.exports
    },
  })
  if (!memory) throw new Error("libvterm instance exposes no WASM memory")
  const vt = raw._termless_vterm_new_utf8!(2, 80)
  const screen = raw._vterm_obtain_screen!(vt)
  const record = raw._termless_vterm_observer_new!(raw._vterm_obtain_state!(vt), 1000)
  const input = new TextEncoder().encode("line\r\n".repeat(1001))
  const ptr = raw._malloc!(input.length)
  try {
    raw._termless_vterm_screen_observe_props!(screen, record)
    raw._vterm_screen_reset!(screen, 1)
    const exercise = () => {
      new Uint8Array(memory!.buffer, ptr, input.length).set(input)
      raw._vterm_input_write!(vt, ptr, input.length)
      expect(raw._termless_vterm_history_count!(record)).toBe(1000)
      raw._termless_vterm_screen_observe_props!(screen, record)
      expect(raw._termless_vterm_history_count!(record)).toBe(0)
    }
    exercise()
    exercise()
    const baselineBytes = memory.buffer.byteLength
    for (let round = 0; round < 40; round++) exercise()
    // A no-free regression retains >100MB here. Allowing 2x warmed memory
    // absorbs allocator growth while still discriminating that native leak.
    expect(memory.buffer.byteLength).toBeLessThanOrEqual(baselineBytes * 2)
  } finally {
    raw._termless_vterm_screen_observe_props!(screen, 0)
    raw._termless_vterm_observer_free!(record)
    raw._free!(ptr)
    raw._vterm_free!(vt)
  }
})

async function probeBackend(query: string): Promise<string[]> {
  const backend: TerminalBackend = createLibvtermBackend(undefined, wasmModule!)
  backend.init?.({ cols: 80, rows: 24 })
  const responses: string[] = []
  backend.onResponse = (b: Uint8Array): void => {
    responses.push(new TextDecoder().decode(b))
  }
  backend.feed(new TextEncoder().encode(query))
  await new Promise<void>((r) => setTimeout(r, 50))
  return responses
}

describeWasm(`window-op probe responses — libvterm backend${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  // CTO c02b6619's retained counterexample (/hh/var/@dev4/30576/libvterm-capacity-numeric.log): libvterm's
  // default 4096-byte output buffer dropped every reply that no longer fit before the adapter drained.
  test("delivers all 2000 ordered CPR replies (15020 bytes) from one feed", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 80, rows: 24 })
    try {
      const responses: string[] = []
      backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
      const positions = Array.from({ length: 2000 }, (_, i) => [1 + (i % 24), 1 + (i % 80)] as const)
      const expected = positions.map(([row, col]) => `\x1b[${row};${col}R`).join("")
      expect(new TextEncoder().encode(expected).length).toBe(15020)
      backend.feed(new TextEncoder().encode(positions.map(([row, col]) => `\x1b[${row};${col}H\x1b[6n`).join("")))
      expect(responses.join("")).toBe(expected)
    } finally {
      backend.destroy()
    }
  })

  // Complete-drain acceptance: one feed must deliver all ordered engine replies.
  // Existing single-query probes never cross the adapter's 1024-byte read boundary.
  // CTO 2cfdb6e8: complete delivery is declared only after whole DA1/DECRQSS replies are measured. Expected bytes
  // follow libvterm 9d6d2112 state.c (DA, request_status_string) and pen.c vterm_state_getpen, behind a backlog
  // larger than libvterm's former 4096-byte output buffer.
  test("delivers whole DA1, DA2 and DECRQSS replies in order behind a 5600-byte reply backlog", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 80, rows: 24 })
    try {
      const responses: string[] = []
      backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
      const exchanges = [
        ["\x1b[c", "\x1b[?1;2c"],
        ["\x1b[>c", "\x1b[>0;100;0c"],
        ["\x1b[1;3;4;5;7;9;38;2;10;20;30;48;5;200m\x1bP$qm\x1b\\", "\x1bP1$r1;3;4;5;7;9;38:2:10:20:30;48:5:200m\x1b\\"],
        ["\x1b[3;20r\x1bP$qr\x1b\\", "\x1bP1$r3;20r\x1b\\"],
        ["\x1b[4 q\x1bP$q q\x1b\\", "\x1bP1$r4 q\x1b\\"],
        ['\x1bP$q"q\x1b\\', '\x1bP1$r2"q\x1b\\'],
        ["\x1bP$qz\x1b\\", "\x1bP0$r\x1b\\"],
        ["\x1b[c", "\x1b[?1;2c"],
      ] as const
      const backlog = "\x1b[24;80R".repeat(700)
      expect(backlog.length).toBe(5600)
      backend.feed(
        new TextEncoder().encode("\x1b[24;80H\x1b[6n".repeat(700) + exchanges.map(([query]) => query).join("")),
      )
      expect(responses.join("")).toBe(backlog + exchanges.map(([, reply]) => reply).join(""))
    } finally {
      backend.destroy()
    }
  })

  test("delivers more than 1024 bytes of ordered engine replies before feed returns", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 80, rows: 24 })
    try {
      const responses: string[] = []
      backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
      const positions = Array.from({ length: 180 }, (_, i) => [1 + (i % 24), 1 + (i % 80)] as const)
      const expected = positions.map(([row, col]) => `\x1b[${row};${col}R`).join("")
      expect(new TextEncoder().encode(expected).length).toBeGreaterThan(1024)
      backend.feed(new TextEncoder().encode(positions.map(([row, col]) => `\x1b[${row};${col}H\x1b[6n`).join("")))
      expect(responses.join("")).toBe(expected)
    } finally {
      backend.destroy()
    }
  })

  // Native observations must survive instance lifecycles without overriding engine reset semantics.
  // The former reply-only reverse assertion could not detect missing native property readback.
  // @failure Missing or shared observations hide native cursor/reverse transitions.
  // @level l2
  // @consumer Terminfo cursor and mode probes
  // @testonly none
  test("observes native properties across reset and isolated instance lifetimes", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    const isolated = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 8, rows: 2 })
    isolated.init({ cols: 8, rows: 2 })
    const responses: string[] = []
    backend.onResponse = (data) => responses.push(new TextDecoder().decode(data))
    try {
      expect(backend.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })
      expect(backend.getMode("reverseVideo")).toBeNull()
      backend.feed(new TextEncoder().encode("\x1b[?5l\x1b[?5$p"))
      expect(responses.join("")).toBe("\x1b[?5;2$y")
      expect(backend.getMode("reverseVideo")).toBe(false)
      expect(isolated.getMode("reverseVideo")).toBeNull()
      responses.length = 0
      backend.feed(new TextEncoder().encode("\x1b[2;4H\x1b[?25l\x1b[6 q"))
      expect(backend.getCursor()).toMatchObject({ row: 1, col: 3, visible: false, style: "beam" })
      expect(isolated.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })
      // Native reports catch an observer that caches a property but vetoes its native store.
      backend.feed(new TextEncoder().encode("\x1bP$q q\x1b\\"))
      expect(responses.join("")).toBe("\x1bP1$r6 q\x1b\\")
      responses.length = 0
      backend.feed(new TextEncoder().encode("\x1b[?5h\x1b[?5$p"))
      expect(responses.join("")).toBe("\x1b[?5;1$y")
      expect(backend.getMode("reverseVideo")).toBe(true)
      // libvterm 0.3.3 preserves reverse mode through API reset and direct RIS.
      backend.reset()
      expect(backend.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })
      responses.length = 0
      backend.feed(new TextEncoder().encode("\x1bc\x1b[?5$p"))
      expect(responses.join("")).toBe("\x1b[?5;1$y")
      expect(backend.getMode("reverseVideo")).toBe(true)
      responses.length = 0
      backend.feed(new TextEncoder().encode("\x1b[?5l\x1b[?5$p"))
      expect(responses.join("")).toBe("\x1b[?5;2$y")
      expect(backend.getMode("reverseVideo")).toBe(false)
      backend.feed(new TextEncoder().encode("\x1b[2;4H\x1b[?25h\x1b[2 q"))
      expect(backend.getCursor()).toMatchObject({ row: 1, col: 3, visible: true, style: "block" })
      backend.feed(new TextEncoder().encode("\x1b[?25l\x1b[6 q"))
      backend.reset()
      expect(backend.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })
      expect(backend.getMode("reverseVideo")).toBe(false)

      isolated.feed(new TextEncoder().encode("\x1b[?25l\x1b[6 q\x1b[?5h"))
      backend.destroy()
      backend.init({ cols: 8, rows: 2 })
      expect(backend.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })
      expect(backend.getMode("reverseVideo")).toBeNull()
      expect(isolated.getCursor()).toMatchObject({ row: 0, col: 0, visible: false, style: "beam" })
      expect(isolated.getMode("reverseVideo")).toBe(true)
      isolated.reset()
      expect(isolated.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })
      expect(isolated.getMode("reverseVideo")).toBe(true)
    } finally {
      backend.destroy()
      isolated.destroy()
    }
  })

  test("keeps unobserved modes unknown (null) instead of returning hard-coded defaults", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 8, rows: 2 })
    try {
      const responses: string[] = []
      backend.onResponse = (b) => responses.push(new TextDecoder().decode(b))
      backend.feed(new TextEncoder().encode("\x1b[?1h\x1b[?7l\x1b[?25l\x1b[?1004h\x1b[?1049h\x1b[?2004h\x1b[?2004$p"))
      for (const mode of [
        "altScreen",
        "cursorVisible",
        "bracketedPaste",
        "autoWrap",
        "focusTracking",
        "originMode",
        "insertMode",
      ] as const) {
        expect(backend.getMode(mode), `expected null for unobserved mode ${mode}`).toBeNull()
      }
      expect(backend.getMode("sgrMouse" as never)).toBeNull()
      expect(responses.join("")).toBe("\x1b[?2004;1$y")
    } finally {
      backend.destroy()
    }
  })

  test("reads fed text and cells through the flat WASM ABI", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 8, rows: 2 })
    try {
      backend.feed(new TextEncoder().encode("A\x1b[1;3;4;38;2;12;34;56;48;2;78;90;123mB\x1b[0mCé世"))
      expect(backend.getText().split("\n")[0]).toBe("ABCé世")
      expect(backend.getCell(0, 0)).toMatchObject({ char: "A", fg: null, bg: null })
      expect(backend.getCell(0, 1)).toMatchObject({
        char: "B",
        dim: null, // The ABI does not expose faint; null is not measured false.
        bold: true,
        italic: true,
        underline: "single",
        fg: { r: 12, g: 34, b: 56 },
        bg: { r: 78, g: 90, b: 123 },
      })
      expect(backend.getCell(0, 2)).toMatchObject({ char: "C", fg: null, bg: null })
      // The backend accepts UTF-8 bytes; ASCII alone cannot detect libvterm
      // accidentally starting in its default legacy single-byte mode.
      expect(backend.getCell(0, 3)).toMatchObject({ char: "é", wide: false })
      expect(backend.getCell(0, 4)).toMatchObject({ char: "世", wide: true })
      expect(backend.getCell(0, 5)).toMatchObject({ char: "", wide: false, continuation: true })
      backend.feed(new TextEncoder().encode("\x1bcé世"))
      expect(backend.getText().split("\n")[0]).toBe("é世")
      expect(backend.getCell(0, 0)).toMatchObject({ char: "é", wide: false })
      expect(backend.getCell(0, 1)).toMatchObject({ char: "世", wide: true })
    } finally {
      backend.destroy()
    }
  })

  // AC2/C9: malformed ABI metadata must not be reported as a valid negative cell attribute.
  // The ABI's pinned underline enum only defines 0..3; existing coverage exercises valid code 1.
  // @failure Unknown libvterm underline ABI values silently become false
  // @level l2
  // @consumer TerminalBackend cell conversion
  // @testonly none
  test("rejects an invalid raw underline code with cell and ABI context", () => {
    const realModule = wasmModule!
    const mod = Object.create(realModule) as LibvtermModule
    const realGetCell = realModule.vterm_screen_get_cell.bind(realModule)
    let underlineCode = 0
    mod.vterm_screen_get_cell = (screen, row, col, ptr) => {
      const found = realGetCell(screen, row, col, ptr)
      // Inject malformed metadata at the actual flat ABI boundary, independent
      // of unrelated context reads performed before cell conversion.
      realModule.setValue(ptr + 3 * 4, underlineCode, "i32")
      return found
    }

    const backend = createLibvtermBackend(undefined, mod)
    backend.init({ cols: 8, rows: 2 })
    try {
      for (const [code, expected] of [
        [0, false],
        [1, "single"],
        [2, "double"],
        [3, "curly"],
      ] as const) {
        underlineCode = code
        expect(backend.getCell(1, 2).underline, `raw underline code ${code}`).toBe(expected)
      }
      underlineCode = 99
      expect(() => backend.getCell(1, 2)).toThrow(/underline code 99.*cell \(1, 2\).*word 3/i)
    } finally {
      backend.destroy()
    }
  })

  test("feeds bytes through exported accessors without requiring HEAPU8", async () => {
    const backend: TerminalBackend = createLibvtermBackend(undefined, wasmModule!)
    backend.init?.({ cols: 80, rows: 24 })
    expect(() => backend.feed(new TextEncoder().encode("ok"))).not.toThrow()
    backend.destroy()
  })

  test("does not synthesize constant CSI 14t or mirror CSI 18t responses when libvterm is silent", async () => {
    expect(await probeBackend("\x1b[14t")).toEqual([])
    expect(await probeBackend("\x1b[18t")).toEqual([])
  })

  // OSC1 acceptance requires the real icon callback and an independent window title;
  // the prior title-only assertions could not detect a discarded ICONNAME property.
  test("observes independent native icon and title properties across fragments, reset, and isolated instances", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    const isolated = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 40, rows: 4 })
    isolated.init({ cols: 40, rows: 4 })
    try {
      expect(backend.getTitle()).toBe("")
      expect(backend.getIconLabel?.()).toBe("")
      backend.feed(new TextEncoder().encode("\x1b]0;osc0-title\x07"))
      expect(backend.getTitle()).toBe("osc0-title")
      expect(backend.getIconLabel?.()).toBe("osc0-title")
      expect(isolated.getTitle()).toBe("")
      expect(isolated.getIconLabel?.()).toBe("")

      backend.feed(new TextEncoder().encode("\x1b]2;osc2-title\x1b\\"))
      expect(backend.getTitle()).toBe("osc2-title")
      expect(backend.getIconLabel?.()).toBe("osc0-title")

      backend.feed(new TextEncoder().encode("\x1b]1;split-"))
      backend.feed(new TextEncoder().encode("icon-é世\x07"))
      expect(backend.getIconLabel?.()).toBe("split-icon-é世")
      expect(backend.getTitle()).toBe("osc2-title")
      expect(isolated.getIconLabel?.()).toBe("")

      // Split write across two feed() calls exercises VTermStringFragment initial/final accumulation
      backend.feed(new TextEncoder().encode("\x1b]2;split-"))
      backend.feed(new TextEncoder().encode("title-é世\x07"))
      expect(backend.getTitle()).toBe("split-title-é世")
      expect(backend.getIconLabel?.()).toBe("split-icon-é世")
      backend.feed(new TextEncoder().encode("\x1b]1;\x07"))
      expect(backend.getIconLabel?.()).toBe("")
      expect(backend.getTitle()).toBe("split-title-é世")

      backend.reset()
      expect(backend.getTitle()).toBe("")
      expect(backend.getIconLabel?.()).toBe("")
      backend.feed(new TextEncoder().encode("\x1b]1;after-reset-icon\x07\x1b]2;after-reset-title\x07"))
      expect(backend.getIconLabel?.()).toBe("after-reset-icon")
      expect(backend.getTitle()).toBe("after-reset-title")
    } finally {
      backend.destroy()
      isolated.destroy()
    }
  })
})
