/**
 * Ghostty backend tests — real WASM-based terminal emulation.
 *
 * Tests the Ghostty backend implementation using ghostty-web WASM.
 * These mirror the xterm.js backend tests to verify cross-backend compatibility.
 */
import { describe, test, expect, beforeAll, afterEach, vi } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { delimiter, join } from "node:path"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { Ghostty, GhosttyTerminal, KeyEncoder } from "ghostty-web"
import * as ghosttyApi from "ghostty-web"
import * as hostKeyEncoding from "../../../src/terminal/key-encoding.ts"
import { resolveGhosttyWebWasm } from "../src/load-native.ts"
import { createGhosttyBackend, initGhostty, _resetSharedForTesting } from "../src/backend.ts"
import type {
  TerminalBackend,
  HyperlinkExtension,
  MouseEncodingExtension,
  MouseEvent,
} from "../../../src/terminal/types.ts"

let ghostty: Ghostty

beforeAll(async () => {
  ghostty = await initGhostty()
})

function createBackend(cols = 80, rows = 24): TerminalBackend {
  const backend = createGhosttyBackend(undefined, ghostty)
  backend.init({ cols, rows })
  return backend
}

function feedText(backend: TerminalBackend, text: string): void {
  backend.feed(new TextEncoder().encode(text))
}

// The two reply paths a consumer reads: the WASM terminal's own response buffer, and the termless backend's
// onResponse. Each write returns only the reply bytes that write produced.
function replyChannel(path: "direct" | "adapter"): { write(text: string): string; dispose(): void } {
  if (path === "direct") {
    const terminal = ghostty.createTerminal(80, 24, { scrollbackLimit: 1000 })
    return {
      write(text: string) {
        terminal.write(text)
        terminal.update()
        let response = ""
        while (terminal.hasResponse()) response += terminal.readResponse() ?? ""
        return response
      },
      dispose: () => terminal.free(),
    }
  }
  const terminal = createBackend()
  let response = ""
  terminal.onResponse = (bytes) => {
    response += new TextDecoder().decode(bytes)
  }
  return {
    write(text: string) {
      response = ""
      feedText(terminal, text)
      return response
    },
    dispose: () => terminal.destroy(),
  }
}

describe("ghostty backend", () => {
  let backend: TerminalBackend

  afterEach(() => {
    if (backend) backend.destroy()
  })

  // @failure A failed reply read is reported as empty, or a native write trap leaks its input buffer.
  // @level l0 @consumer GhosttyTerminal reply ABI. Success-path engine tests cannot force these ABI errors.
  test("distinguishes failed and empty reply reads and frees input after a write trap", () => {
    const memory = new WebAssembly.Memory({ initial: 1 })
    let status = -1
    const release = vi.fn()
    const terminal = new GhosttyTerminal(
      {
        ghostty_terminal_new: () => 1,
        ghostty_terminal_free: () => {},
        ghostty_wasm_alloc_u8_array: () => 16,
        ghostty_wasm_free_u8_array: release,
        ghostty_terminal_has_response: () => true,
        ghostty_terminal_read_response: () => status,
        ghostty_terminal_write: () => {
          throw new WebAssembly.RuntimeError("producer failed")
        },
      } as unknown as ConstructorParameters<typeof GhosttyTerminal>[0],
      memory,
      2,
      1,
    )
    expect(() => terminal.readResponse()).toThrow(/response.*-1/)
    expect(release).toHaveBeenLastCalledWith(16, 256)
    status = 0
    expect(terminal.readResponse()).toBeNull()
    expect(() => terminal.write("\x1b[c")).toThrow("producer failed")
    expect(release).toHaveBeenLastCalledWith(16, 3)
    terminal.free()
  })

  // @failure The native producer drops replies on allocator failure while feed returns successfully (#32286).
  // @level l0 @consumer TerminalBackend.feed. Other tests exercise only successful WASM allocations.
  test("propagates a real reply producer allocation failure through feed", () => {
    // bun --bun prepends a node shim; this pressure test needs V8's real 16 MiB cap.
    const node = process.versions.bun
      ? process.env.PATH?.split(delimiter)
          .map((directory) => Bun.which("node", { PATH: directory }))
          .find(
            (candidate) =>
              candidate &&
              execFileSync(candidate, ["-p", "process.versions.bun ? 'bun' : 'node'"], {
                encoding: "utf8",
              }).trim() === "node",
          )
      : process.execPath
    expect(node, "the allocator pressure test requires the installed Node runtime").toBeTruthy()
    const wasm = resolveGhosttyWebWasm()
    const script = String.raw`
      import { readFileSync } from 'node:fs';
      import assert from 'node:assert/strict';
      assert.equal(process.versions.bun, undefined, 'allocator pressure must run in Node');
      assert.throws(() => new WebAssembly.Memory({initial:257}), RangeError, '16 MiB WASM cap must apply before allocation pressure');
      globalThis.self = globalThis;
      const { createGhosttyBackend } = await import(process.argv[1]);
      const { Ghostty } = await import(process.argv[2]);
      const { instance } = await WebAssembly.instantiate(readFileSync(process.argv[3]), {env:{log(){}}});
      const e = instance.exports, held = [];
      const input = new TextEncoder().encode('\x1b[c'.repeat(200));
      let forcing = false, reserved;
      const ffi = {...e,
        // Reserve only the input allocation: the producer still uses its real exhausted allocator.
        ghostty_wasm_alloc_u8_array(size) {
          return forcing && size === input.length ? reserved : e.ghostty_wasm_alloc_u8_array(size);
        },
        ghostty_terminal_write(...args) {
          try { return e.ghostty_terminal_write(...args); }
          finally {
            // Release pressure before update/read so only a producer failure can satisfy the assertion.
            for (const [ptr,size] of held) e.ghostty_wasm_free_u8_array(ptr,size);
            held.length = 0;
          }
        }
      };
      const backend = createGhosttyBackend(undefined, new Ghostty({exports:ffi}));
      backend.init({cols:2,rows:1});
      let response = '';
      backend.onResponse = data => response += new TextDecoder().decode(data);
      backend.feed(new TextEncoder().encode('\x1b[c'));
      assert.equal(response, '\x1b[?62;22c');
      reserved = e.ghostty_wasm_alloc_u8_array(input.length);
      assert.ok(reserved);
      for (const size of [65536,4096,256,16,1]) {
        for (let i=0;i<100000;i++) {
          const ptr = e.ghostty_wasm_alloc_u8_array(size);
          if (!ptr) break;
          held.push([ptr,size]);
          assert.notEqual(i,99999,'allocator did not exhaust within bound');
        }
      }
      forcing = true;
      assert.throws(() => backend.feed(input), WebAssembly.RuntimeError);
      backend.destroy();
    `
    execFileSync(
      node!,
      [
        "--wasm-max-mem-pages=256",
        "--input-type=module",
        "-e",
        script,
        new URL("../src/backend.ts", import.meta.url).href,
        pathToFileURL(join(wasm, "..", "dist", "ghostty-web.js")).href,
        wasm,
      ],
      { encoding: "utf8", timeout: 30000 },
    )
  })

  // @failure A borrowed-string wrapper keeps a detached view, frees bytes before copying, or conflates status 0/1.
  // @level l0 @consumer GhosttyTerminal URI/CWD ABI. Real engine tests cannot force memory growth or ABI failures.
  test.each(["hyperlink", "cwd"] as const)("copies %s bytes before another WASM call and releases scratch on every ABI outcome", (reader) => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 32 })
    const uri = "https://example.com/é:a"
    let status = 1
    let length = new TextEncoder().encode(uri).length
    let outOfMemory = false
    const release = vi.fn(() => new Uint8Array(memory.buffer, 64, 64).fill(0))
    const allocate = vi.fn(() => {
      if (outOfMemory) return 0
      memory.grow(1)
      return 8
    })
    // Only the FFI is controlled here; the wrapper and WebAssembly.Memory are production/real.
    const exports: Record<string, unknown> = {
      memory,
      ghostty_terminal_new: () => 1,
      ghostty_terminal_free: () => {},
      ghostty_wasm_alloc_u8_array: allocate,
      ghostty_wasm_free_u8_array: release,
      [reader === "cwd" ? "ghostty_terminal_get_cwd" : "ghostty_render_state_get_hyperlink"]: (...args: number[]) => {
        const out = args.at(-1)!
        memory.grow(1)
        new Uint8Array(memory.buffer).set(new TextEncoder().encode(uri), 64)
        const words = new DataView(memory.buffer, out, 8)
        words.setUint32(0, 64, true)
        words.setUint32(4, length, true)
        return status
      },
    }
    const terminal = new GhosttyTerminal(
      exports as unknown as ConstructorParameters<typeof GhosttyTerminal>[0],
      memory,
      2,
      1,
    )
    const get = () => reader === "cwd" ? terminal.getCwd() : terminal.getHyperlinkAt(0, 1)
    expect(get()).toBe(uri)
    expect(release).toHaveBeenLastCalledWith(8, 8)
    length = 0
    expect(get()).toBe("")
    status = 0
    expect(get()).toBeNull()
    for (const invalid of [-1, 2]) {
      status = invalid
      const frees = release.mock.calls.length
      expect(get).toThrow(`status ${invalid}`)
      expect(release.mock.calls.length).toBe(frees + 1)
    }
    const frees = release.mock.calls.length
    outOfMemory = true
    expect(get).toThrow(/allocate/)
    expect(release.mock.calls.length).toBe(frees)
    const lookup = reader === "cwd" ? "ghostty_terminal_get_cwd" : "ghostty_render_state_get_hyperlink"
    exports[lookup] = undefined
    expect(get).toThrow(`missing ${lookup}`)
    terminal.free()
    expect(get).toThrow(/freed/)
  })

  // @failure The viewport wrapper reads a detached view after memory growth, leaks scratch on a failed read, coerces a
  // bad delta, or reports a default instead of failing (#31392).
  // @level l0 @consumer GhosttyTerminal viewport ABI. The real engine cannot force a failed status, allocation or growth.
  test("reads viewport words after memory growth, frees scratch on every outcome and rejects bad deltas", () => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 32 })
    let status = 0
    let outOfMemory = false
    const release = vi.fn()
    const deltas: number[] = []
    // Only the FFI is controlled here; the wrapper and WebAssembly.Memory are production/real.
    const exports: Record<string, unknown> = {
      memory,
      ghostty_terminal_new: () => 1,
      ghostty_terminal_free: () => {},
      ghostty_wasm_alloc_u8_array: () => (outOfMemory ? 0 : 16),
      ghostty_wasm_free_u8_array: release,
      ghostty_terminal_get_viewport_state: (_handle: number, out: number) => {
        memory.grow(1)
        const words = new DataView(memory.buffer, out, 12)
        words.setUint32(0, 40, true)
        words.setUint32(4, 30, true)
        words.setUint32(8, 10, true)
        return status
      },
      ghostty_terminal_scroll_viewport: (_handle: number, delta: number) => {
        deltas.push(delta)
        return status
      },
    }
    const terminal = new GhosttyTerminal(
      exports as unknown as ConstructorParameters<typeof GhosttyTerminal>[0],
      memory,
      2,
      10,
    )
    expect(terminal.getViewportState()).toEqual({ totalRows: 40, viewportTop: 30, screenRows: 10 })
    expect(release).toHaveBeenLastCalledWith(16, 12)
    terminal.scrollViewport(-2147483647)
    terminal.scrollViewport(2147483647)
    expect(deltas).toEqual([-2147483647, 2147483647])
    for (const invalid of [-2147483648, 2147483648, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => terminal.scrollViewport(invalid)).toThrow(RangeError)
    }
    expect(deltas).toHaveLength(2)
    status = -1
    const frees = release.mock.calls.length
    expect(() => terminal.getViewportState()).toThrow("status -1")
    expect(release.mock.calls.length).toBe(frees + 1)
    expect(() => terminal.scrollViewport(1)).toThrow("status -1")
    status = 0
    outOfMemory = true
    expect(() => terminal.getViewportState()).toThrow(/allocate/)
    expect(release.mock.calls.length).toBe(frees + 1)
    exports.ghostty_terminal_get_viewport_state = undefined
    exports.ghostty_terminal_scroll_viewport = undefined
    expect(() => terminal.getViewportState()).toThrow(/missing ghostty_terminal_get_viewport_state/)
    expect(() => terminal.scrollViewport(1)).toThrow(/missing ghostty_terminal_scroll_viewport/)
    terminal.free()
    expect(() => terminal.getViewportState()).toThrow(/freed/)
    expect(() => terminal.scrollViewport(1)).toThrow(/freed/)
  })

  test("committed producer outputs match the pinned build receipt", () => {
    const directory = join(import.meta.dirname, "../../../vendor/ghostty-web")
    const receipt = JSON.parse(readFileSync(join(directory, "RECEIPT.json"), "utf8")) as {
      patchSha256: string
      innerPatchSha256: string
      corePatch: { file: string; sha256: string }
      outputs: Record<string, string>
    }
    for (const [path, expected] of Object.entries({
      ...receipt.outputs,
      "producer.patch": receipt.patchSha256,
      "ghostty-wasm-api.patch": receipt.innerPatchSha256,
      [receipt.corePatch.file]: receipt.corePatch.sha256,
    })) {
      expect(
        createHash("sha256")
          .update(readFileSync(join(directory, path)))
          .digest("hex"),
        path,
      ).toBe(expected)
    }
  })

  // @failure OSC 8 URI is lost or read from the wrong buffer row during lifecycle changes.
  // @level l0 @consumer Cell.hyperlink and HyperlinkExtension
  // Existing rendering tests never read URI values; use the real WASM and adapter, with no new test seam.
  test("OSC 8 URI observations survive buffer lifecycle", () => {
    let raw: GhosttyTerminal | undefined
    const create = ghostty.createTerminal.bind(ghostty)
    const spy = vi.spyOn(ghostty, "createTerminal").mockImplementation((...args) => {
      raw = create(...args)
      return raw
    })
    try {
      backend = createBackend(16, 3)
    } finally {
      spy.mockRestore()
    }
    const uri = "https://example.com:8443/a:b?q=c:d"
    const open = `\x1b]8;id=not-the-uri;${uri}\x1b\\`
    const close = "\x1b]8;;\x1b\\"
    feedText(backend, `A${open}LINK${close}Z`)
    // This must fail on the old adapter's actual wrong-null value before any new API is called.
    expect(backend.getCell(0, 1).hyperlink).toBe(uri)
    const links = backend as TerminalBackend & HyperlinkExtension
    expect(backend.capabilities.extensions.has("hyperlinks")).toBe(true)
    const at = (row: number, col: number, char: string, hyperlink: string | null) => {
      expect(backend.getCell(row, col)).toMatchObject({ char, hyperlink })
      expect(backend.getRow(row)[col]).toMatchObject({ char, hyperlink })
      expect(links.getHyperlinkAt(row, col)).toBe(hyperlink)
    }
    for (const [col, char] of [..."ALINKZ"].entries()) {
      at(0, col, char, col > 0 && col < 5 ? uri : null)
    }
    const copied = links.getHyperlinkAt(0, 1)
    feedText(backend, "\x1b[1;2HX")
    at(0, 1, "X", null)
    expect(copied).toBe(uri)

    backend.reset()
    feedText(backend, `${open}OLD${close}\r\none\r\ntwo\r\n${open}LIVE${close}`)
    expect(backend.getScrollback().viewportTop).toBe(1)
    at(0, 0, "O", uri)
    at(1, 0, "o", null)
    at(3, 0, "L", uri)
    // The pinned producer retains the cursor on 1049h; select the tested cell explicitly.
    feedText(backend, `\x1b[?1049h\x1b[H${open}ALT${close}`)
    expect(backend.getScrollback().viewportTop).toBe(0)
    at(0, 0, "A", uri)
    feedText(backend, "\x1b[?1049l")
    expect(backend.getScrollback().viewportTop).toBe(1)
    at(0, 0, "O", uri)
    at(3, 0, "L", uri)
    backend.resize(20, 4)
    at(0, 0, "O", uri)
    at(3, 0, "L", uri)
    backend.reset()
    expect(links.getHyperlinkAt(0, 0)).toBeNull()
    expect(copied).toBe(uri)

    feedText(backend, "\x1b[1;3m界e\u0301\x1b[0m")
    const plain = backend.getRow(0).slice(0, 3)
    expect(plain[0]).toMatchObject({ char: "界", wide: true, bold: true, italic: true })
    expect(plain[2]?.char).toBe("e\u0301")
    backend.reset()
    feedText(backend, `\x1b[1;3m${open}界e\u0301${close}\x1b[0m`)
    if (!raw) throw new Error("Ghostty terminal was not created")
    const producer = raw.getLine(0)
    if (!producer) throw new Error("Ghostty producer returned no live row")
    for (let col = 0; col < 3; col++) {
      const cell = backend.getCell(0, col)
      const native = producer[col]
      if (!native) throw new Error(`Ghostty producer returned no cell at 0:${col}`)
      // The engine decides whether its wide continuation owns a hyperlink; preserve its metadata.
      const hyperlink = native.hyperlink_id ? uri : null
      expect(cell).toEqual({ ...plain[col], hyperlink })
      at(0, col, cell.char, hyperlink)
    }
    expect(links.getHyperlinkAt(-1, 0)).toBeNull()
    expect(links.getHyperlinkAt(0, 20)).toBeNull()
    backend.destroy()
    expect(() => links.getHyperlinkAt(0, 0)).toThrow("not initialized")
  })

  // Q4: real producer replies must reflect the active screen's keyboard stack.
  // Rendering/receipt tests cannot detect an ignored query action.
  test.each(["direct", "adapter"] as const)(
    "Kitty flags queries preserve lifecycle and response order via %s",
    (path) => {
      const create = () => replyChannel(path)
      const first = create()
      const second = create()
      try {
        expect(first.write("\x1b[5n")).toBe("\x1b[0n")
        expect(first.write("\x1b[?u")).toBe("\x1b[?0u")
        for (const flags of [1, 3, 5, 9, 25, 31]) {
          expect(first.write(`\x1b[>${flags}u\x1b[?u\x1b[<u\x1b[?u`)).toBe(`\x1b[?${flags}u\x1b[?0u`)
        }
        for (const [flags, mode, expected] of [
          [8, 1, 8],
          [3, 2, 11],
          [2, 3, 9],
          [31, 1, 31],
        ]) {
          expect(first.write(`\x1b[=${flags};${mode}u\x1b[?u`)).toBe(`\x1b[?${expected}u`)
        }
        expect(first.write("\x1bc\x1b[?u")).toBe("\x1b[?0u")
        expect(first.write("\x1b[>5u\x1b[?u")).toBe("\x1b[?5u")
        expect(second.write("\x1b[?u")).toBe("\x1b[?0u")
        expect(second.write("\x1b[>9u\x1b[?u")).toBe("\x1b[?9u")
        expect(first.write("\x1b[?u")).toBe("\x1b[?5u")
        expect(first.write("\x1b[?1049h\x1b[?u\x1b[>25u\x1b[?u")).toBe("\x1b[?0u\x1b[?25u")
        expect(first.write("\x1b[?1049l\x1b[?u")).toBe("\x1b[?5u")
        expect(first.write("\x1b[?u\x1b[<u\x1b[?u")).toBe("\x1b[?5u\x1b[?0u")
        expect(first.write("\x1b[5n\x1b[6n")).toBe("\x1b[0n\x1b[1;1R")
      } finally {
        first.dispose()
        second.dispose()
      }
    },
  )

  // @failure The WASM patch filed .request_mode / .request_mode_unknown under "Actions that require no
  // response", so the DECRPM reply core formats never reached response_buffer (#32024). Rendering/receipt
  // tests cannot detect a dropped reply; only the real producer's reply bytes can.
  test.each(["direct", "adapter"] as const)("DECRPM queries reach the reply path via %s", (path) => {
    const create = () => replyChannel(path)
    const first = create()
    const second = create()
    try {
      // The seven headlessDecrpmArm modes (terminfo.dev probe-defs modes.ts): set reports Ps 1, reset Ps 2.
      for (const mode of [1, 1000, 1003, 1004, 1005, 1006, 2004]) {
        expect(first.write(`\x1b[?${mode}$p`)).toBe(`\x1b[?${mode};2$y`)
        expect(first.write(`\x1b[?${mode}h\x1b[?${mode}$p`)).toBe(`\x1b[?${mode};1$y`)
        expect(first.write(`\x1b[?${mode}l\x1b[?${mode}$p`)).toBe(`\x1b[?${mode};2$y`)
      }
      // Deliberate re-baselines (ghostty-reply-fix-spec-1031 "Risk"): device.decrpm queries mode 7, which
      // core defaults on, and extensions.osc5522-clipboard queries 5522, which is outside core's mode table
      // and therefore answers Ps 0 ("not recognized") instead of staying silent.
      expect(first.write("\x1b[?7$p")).toBe("\x1b[?7;1$y")
      expect(first.write("\x1b[?5522$p")).toBe("\x1b[?5522;0$y")
      expect(first.write("\x1b[?7l\x1b[?7$p\x1b[?7h")).toBe("\x1b[?7;2$y")
      // Private modes outside core's table answer Ps 0 the same way. (ANSI `CSI Ps $ p` never reaches the
      // handler: core 5714ed07 src/terminal/stream.zig:1583 dispatches DECRQM only for the `?$` form.)
      expect(first.write("\x1b[?9999$p")).toBe("\x1b[?9999;0$y")
      // Replies keep stream order with the existing DSR and kitty replies, and stay per instance.
      expect(first.write("\x1b[?2004h\x1b[5n\x1b[?2004$p\x1b[?u\x1b[6n")).toBe("\x1b[0n\x1b[?2004;1$y\x1b[?0u\x1b[1;1R")
      expect(second.write("\x1b[?2004$p")).toBe("\x1b[?2004;2$y")
      expect(first.write("\x1b[?2004l\x1b[?2004$p")).toBe("\x1b[?2004;2$y")
      // Reset restores the defaults the reply reports.
      expect(first.write("\x1b[?1h\x1bc\x1b[?1$p\x1b[?7$p")).toBe("\x1b[?1;2$y\x1b[?7;1$y")
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  // @failure The WASM patch filed .device_attributes, .xtversion and .dcs_hook/.dcs_put/.dcs_unhook under "Actions
  // that require no response", so DA1, DA2, XTVERSION, DECRQSS and XTGETTCAP never reached response_buffer (#32057).
  // Only the real producer's reply bytes show a dropped reply. The stays are pinned too: each is a reply core with its
  // default config does not give from this artifact, and a stray reply there is as wrong as a missing one.
  test.each(["direct", "adapter"] as const)(
    "identity, DECRQSS and XTGETTCAP queries reach the reply path via %s",
    (path) => {
      const first = replyChannel(path)
      const second = replyChannel(path)
      try {
        // DA1 in the clipboard-deny form (no 52: the shim has no clipboard write) and no 4 (no sixel); DA2; XTVERSION.
        expect(first.write("\x1b[c")).toBe("\x1b[?62;22c")
        expect(first.write("\x1b[>c")).toBe("\x1b[>1;10;0c")
        // Replies behind a backlog cross the wrapper's 256-byte reads without losing their tail or order.
        expect(first.write("\x1b[c".repeat(100) + "\x1b[>c")).toBe("\x1b[?62;22c".repeat(100) + "\x1b[>1;10;0c")
        expect(first.write("\x1b[>q")).toBe("\x1bP>|ghostty 1.3.0-dev+0000000\x1b\\")
        // DECRQSS reports the live state: SGR, DECSTBM, DECSCUSR (default steady block, matching the DECRQM ?12 reset
        // reply), and the invalid form for DECSLRM while left/right margin mode is off and for an unknown setting.
        expect(first.write("\x1bP$qm\x1b\\")).toBe("\x1bP1$r0m\x1b\\")
        expect(first.write("\x1b[1;31m\x1bP$qm\x1b\\\x1b[0m")).toBe("\x1bP1$r0;1;31m\x1b\\")
        expect(first.write("\x1bP$qr\x1b\\")).toBe("\x1bP1$r1;24r\x1b\\")
        expect(first.write("\x1b[5;20r\x1bP$qr\x1b\\\x1b[r")).toBe("\x1bP1$r5;20r\x1b\\")
        expect(first.write("\x1b[?12$p\x1bP$q q\x1b\\")).toBe("\x1b[?12;2$y\x1bP1$r2 q\x1b\\")
        expect(first.write("\x1b[4 q\x1bP$q q\x1b\\\x1b[0 q")).toBe("\x1bP1$r4 q\x1b\\")
        expect(first.write("\x1bP$qs\x1b\\")).toBe("\x1bP0$r\x1b\\")
        expect(first.write("\x1bP$qx\x1b\\")).toBe("\x1bP0$r\x1b\\")
        // XTGETTCAP answers from core's terminfo map, one reply per known key; an unknown key is skipped, as core does.
        expect(first.write("\x1bP+q544e\x1b\\")).toBe("\x1bP1+r544E=787465726D2D67686F73747479\x1b\\")
        expect(first.write("\x1bP+q544e;7a7a7a;436f\x1b\\")).toBe(
          "\x1bP1+r544E=787465726D2D67686F73747479\x1b\\\x1bP1+r436F=323536\x1b\\",
        )
        // The 12 stays (@cto 25157a35): DA3, XTWINOPS 14/16/21 (21: title-report defaults off), XTGETXRES, OSC 52
        // queries x3, DSR 996, and kitty graphics x3 (compiled out of lib-vt with oniguruma).
        for (const query of [
          "\x1b[=c",
          "\x1b[14t",
          "\x1b[16t",
          "\x1b[21t",
          "\x1bP+Q666f726567726f756e64\x1b\\",
          "\x1b]52;c;?\x07",
          "\x1b]52;p;?\x1b\\",
          "\x1b]52;s;?\x07",
          "\x1b[?996n",
          "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\",
          "\x1b_Gi=32,s=1,v=1,a=T,f=24;AAAA\x1b\\",
          "\x1b_Ga=p,i=31\x1b\\",
        ]) {
          expect(first.write(query), JSON.stringify(query)).toBe("")
        }
        // Replies keep stream order with the existing DSR and DECRPM replies, and DCS state stays per instance:
        // a DCS left open in one terminal does not swallow the next instance's query.
        expect(first.write("\x1b[5n\x1b[c\x1bP$qr\x1b\\\x1b[?2004$p\x1b[6n")).toBe(
          "\x1b[0n\x1b[?62;22c\x1bP1$r1;24r\x1b\\\x1b[?2004;2$y\x1b[1;1R",
        )
        expect(first.write("\x1bP$q")).toBe("")
        expect(second.write("\x1bP+q436f\x1b\\")).toBe("\x1bP1+r436F=323536\x1b\\")
        expect(first.write("m\x1b\\")).toBe("\x1bP1$r0m\x1b\\")
      } finally {
        first.dispose()
        second.dispose()
      }
    },
  )

  test.each(["viewport", "scrollback"] as const)("rejects invalid producer ordinals in %s with its digest", (path) => {
    const original = ghostty.createTerminal.bind(ghostty)
    const spy = vi.spyOn(ghostty, "createTerminal").mockImplementation((...args) => {
      const terminal = original(...args)
      const method = path === "viewport" ? "getLine" : "getScrollbackLine"
      const read = terminal[method].bind(terminal)
      terminal[method] = (row) => {
        const cells = read(row)
        if (cells?.[0]) cells[0].underline_style = 6
        return cells
      }
      return terminal
    })
    try {
      backend = createBackend(12, 2)
      feedText(backend, "X")
      if (path === "scrollback") feedText(backend, "\r\nZ\r\nW")
      expect(() => backend.getCell(0, 0)).toThrow(
        `Ghostty producer ${createHash("sha256").update(readFileSync(resolveGhosttyWebWasm())).digest("hex")} returned invalid underline_style 6`,
      )
    } finally {
      spy.mockRestore()
    }
  })

  describe("lifecycle", () => {
    test("creates with correct name", () => {
      backend = createBackend()
      expect(backend.name).toBe("ghostty")
    })

    test("throws before init", () => {
      backend = createGhosttyBackend(undefined, ghostty)
      expect(() => backend.getText()).toThrow("not initialized")
    })

    test("uses sharedGhostty when no explicit instance passed", () => {
      // After initGhostty(), createGhosttyBackend() uses the shared instance
      const b = createGhosttyBackend()
      b.init({ cols: 80, rows: 24 })
      expect(b.getText()).toBeDefined()
      b.destroy()
    })

    test("init throws clear error when WASM not loaded and no instance provided", async () => {
      // Temporarily clear the shared instance to test the guard
      _resetSharedForTesting()
      try {
        const b = createGhosttyBackend()
        expect(() => b.init({ cols: 80, rows: 24 })).toThrow("Ghostty WASM not loaded")
      } finally {
        // Restore shared instance for subsequent tests
        ghostty = await initGhostty()
      }
    })

    test("re-init destroys previous terminal", () => {
      backend = createGhosttyBackend(undefined, ghostty)
      backend.init({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("First"))
      expect(backend.getText()).toContain("First")

      // Re-init should work cleanly (no leak from previous terminal)
      backend.init({ cols: 40, rows: 10 })
      expect(backend.getText()).not.toContain("First")
    })

    test("destroy makes backend unusable until next init", () => {
      backend = createGhosttyBackend(undefined, ghostty)
      backend.init({ cols: 80, rows: 24 })
      backend.destroy()
      expect(() => backend.getText()).toThrow("not initialized")

      // Can re-init after destroy
      backend.init({ cols: 80, rows: 24 })
      expect(backend.getText()).toBeDefined()
    })
  })

  describe("text rendering", () => {
    test("renders plain text", () => {
      backend = createBackend()
      feedText(backend, "Hello, world!")
      const text = backend.getText()
      expect(text).toContain("Hello, world!")
    })

    test("renders multiple lines", () => {
      backend = createBackend()
      feedText(backend, "Line 1\r\nLine 2\r\nLine 3")
      const text = backend.getText()
      expect(text).toContain("Line 1")
      expect(text).toContain("Line 2")
      expect(text).toContain("Line 3")
    })

    test("handles cursor positioning", () => {
      backend = createBackend(40, 10)
      feedText(backend, "\x1b[3;5HPlaced") // Move to row 3, col 5
      const text = backend.getText()
      expect(text).toContain("Placed")
    })

    test("handles line wrapping", () => {
      backend = createBackend(10, 5)
      feedText(backend, "1234567890abcde") // Should wrap at col 10
      const text = backend.getText()
      expect(text).toContain("1234567890")
      expect(text).toContain("abcde")
    })
  })

  describe("cell attributes", () => {
    test("detects bold", () => {
      backend = createBackend()
      feedText(backend, "\x1b[1mBold\x1b[0m Normal")
      const boldCell = backend.getCell(0, 0)
      expect(boldCell.bold).toBe(true)
      expect(boldCell.char).toBe("B")

      const normalCell = backend.getCell(0, 5)
      expect(normalCell.bold).toBe(false)
    })

    test("detects italic", () => {
      backend = createBackend()
      feedText(backend, "\x1b[3mItalic\x1b[0m")
      expect(backend.getCell(0, 0).italic).toBe(true)
    })

    test("detects faint/dim", () => {
      backend = createBackend()
      feedText(backend, "\x1b[2mFaint\x1b[0m")
      expect(backend.getCell(0, 0).dim).toBe(true)
    })

    // CTO Stage B: the real installed producer must preserve each style in both
    // viewport and history; the previous single-only case missed rich-style collapse.
    test.each([
      ["none", "\x1b[24m", false],
      ["single", "\x1b[4m", "single"],
      ["double", "\x1b[21m", "double"],
      ["double colon", "\x1b[4:2m", "double"],
      ["curly", "\x1b[4:3m", "curly"],
      ["dotted", "\x1b[4:4m", "dotted"],
      ["dashed", "\x1b[4:5m", "dashed"],
    ] as const)("preserves %s underline in viewport and scrollback", (_name, sequence, expected) => {
      backend = createBackend(12, 2)
      feedText(backend, `\x1b[1m${sequence}X\x1b[24mY`)
      const check = () => {
        expect(backend.getCell(0, 0)).toMatchObject({ char: "X", underline: expected, bold: true })
        expect(backend.getCell(0, 1)).toMatchObject({ char: "Y", underline: false, bold: true })
      }
      check()
      feedText(backend, "\r\nZ\r\nW")
      expect(backend.getScrollback().totalRows).toBeGreaterThan(2)
      check()
    })

    // @failure The paired cell ABI omits colour, confuses explicit black with absence, or loses it in history.
    // @level l0 @consumer Cell.underlineColor; the existing style tests never inspect underline colour.
    test("preserves resolved underline colour and absence in viewport, reused cells and history", () => {
      backend = createBackend(12, 2)
      feedText(backend, "\x1b[1;3;4m\x1b[59mA\x1b[58;2;255;0;128mB\x1b[58;2;0;0;0mC\x1b[59mD\x1b[58;5;4mE\x1b[38;5;4mF")
      const check = () => {
        const cells = Array.from({ length: 6 }, (_, col) => backend.getCell(0, col))
        expect(cells.map((cell) => cell.char).join("")).toBe("ABCDEF")
        for (const cell of cells) expect(cell).toMatchObject({ bold: true, italic: true, underline: "single" })
        expect(cells[0]!.underlineColor).toBeNull()
        expect(cells[1]!.underlineColor).toEqual({ r: 255, g: 0, b: 128 })
        expect(cells[2]!.underlineColor).toEqual({ r: 0, g: 0, b: 0 })
        expect(cells[3]!.underlineColor).toBeNull()
        expect(cells[5]!.fg).not.toBeNull()
        expect(cells[4]!.underlineColor).toEqual(cells[5]!.fg)
      }
      check()
      feedText(backend, "\x1b[1;7H\x1b[58;2;3;2;1mG")
      expect(backend.getCell(0, 6).underlineColor).toEqual({ r: 3, g: 2, b: 1 })
      feedText(backend, "\x1b[1;7H\x1b[59mH")
      expect(backend.getCell(0, 6).underlineColor).toBeNull()
      feedText(backend, "\r\nZ\r\nW")
      expect(backend.getScrollback().totalRows).toBeGreaterThan(2)
      check()
    })

    test("detects strikethrough", () => {
      backend = createBackend()
      feedText(backend, "\x1b[9mStrike\x1b[0m")
      expect(backend.getCell(0, 0).strikethrough).toBe(true)
    })

    test("detects inverse", () => {
      backend = createBackend()
      feedText(backend, "\x1b[7mInverse\x1b[0m")
      expect(backend.getCell(0, 0).inverse).toBe(true)
    })

    // ghostty-web exposes BLINK (64) and INVISIBLE (32) in CellFlags; dropping them reported a
    // blinking or hidden cell as plain, which also renders the cell wrongly for every consumer.
    test("detects blink", () => {
      backend = createBackend()
      feedText(backend, "\x1b[5mBlink\x1b[0m")
      expect(backend.getCell(0, 0).blink).toBe(true)
    })

    test("detects hidden (invisible)", () => {
      backend = createBackend()
      feedText(backend, "\x1b[8mHidden\x1b[0m")
      expect(backend.getCell(0, 0).hidden).toBe(true)
    })

    test("detects truecolor foreground", () => {
      backend = createBackend()
      feedText(backend, "\x1b[38;2;255;0;0mRed\x1b[0m")
      const cell = backend.getCell(0, 0)
      expect(cell.fg).toEqual({ r: 255, g: 0, b: 0 })
    })

    test("detects truecolor background", () => {
      backend = createBackend()
      feedText(backend, "\x1b[48;2;0;255;0mGreen BG\x1b[0m")
      const cell = backend.getCell(0, 0)
      expect(cell.bg).toEqual({ r: 0, g: 255, b: 0 })
    })

    test("detects wide characters", () => {
      backend = createBackend()
      feedText(backend, "🎉")
      const cell = backend.getCell(0, 0)
      expect(cell.wide).toBe(true)
    })
  })

  describe("getLine / getLines", () => {
    test("returns cells for a row", () => {
      backend = createBackend(20, 5)
      feedText(backend, "ABCDE")
      const line = backend.getLine(0)
      expect(line[0]!.char).toBe("A")
      expect(line[1]!.char).toBe("B")
      expect(line[4]!.char).toBe("E")
    })

    test("returns all rows", () => {
      backend = createBackend(20, 5)
      feedText(backend, "Row0\r\nRow1\r\nRow2")
      const lines = backend.getLines()
      expect(lines).toHaveLength(5) // All screen rows
    })
  })

  describe("getTextRange", () => {
    test("extracts rectangular region", () => {
      backend = createBackend(20, 5)
      feedText(backend, "ABCDEFGH\r\n12345678")
      const range = backend.getTextRange(0, 2, 1, 6)
      expect(range).toContain("CDEF")
      expect(range).toContain("3456")
    })
  })

  describe("cursor", () => {
    test("reports cursor position", () => {
      backend = createBackend()
      feedText(backend, "Hello")
      const cursor = backend.getCursor()
      expect(cursor.x).toBe(5)
      expect(cursor.y).toBe(0)
    })

    test("tracks cursor after newlines", () => {
      backend = createBackend()
      feedText(backend, "Line1\r\nLine2")
      const cursor = backend.getCursor()
      expect(cursor.y).toBe(1)
      expect(cursor.x).toBe(5)
    })

    test("tracks cursor with escape sequences", () => {
      backend = createBackend()
      feedText(backend, "\x1b[5;10H") // Move to row 5, col 10 (1-based)
      const cursor = backend.getCursor()
      expect(cursor.y).toBe(4) // 0-based
      expect(cursor.x).toBe(9) // 0-based
    })

    test("reports cursor visibility as booleans through show/hide/show", () => {
      backend = createBackend()
      feedText(backend, "\x1b[?25h")
      const shown = backend.getCursor().visible
      feedText(backend, "\x1b[?25l")
      const hidden = backend.getCursor().visible
      feedText(backend, "\x1b[?25h")
      const shownAgain = backend.getCursor().visible

      expect([shown, hidden, shownAgain]).toEqual([true, false, true])
    })
  })

  describe("modes", () => {
    // A parsed mode must expose its actual state, not remain an unknown adapter readback.
    test.each([
      ["altScroll", 1007],
      ["syncOutput", 2026],
      ["colorSchemeReporting", 2031],
      ["smoothScroll", 4],
    ] as const)("reads %s after private-mode reset and set", (mode, number) => {
      backend = createBackend()
      feedText(backend, `\x1b[?${number}l`)
      expect(backend.getMode(mode)).toBe(false)
      feedText(backend, `\x1b[?${number}h`)
      expect(backend.getMode(mode)).toBe(true)
      // Private mode 4 is DECSCLM; it must not read or alter ANSI insert mode.
      expect(backend.getMode("insertMode")).toBe(false)
      feedText(backend, `\x1b[?${number}l`)
      expect(backend.getMode(mode)).toBe(false)
    })

    test("detects alt screen mode", () => {
      backend = createBackend()
      expect(backend.getMode("altScreen")).toBe(false)
      feedText(backend, "\x1b[?1049h") // Enter alt screen
      expect(backend.getMode("altScreen")).toBe(true)
      feedText(backend, "\x1b[?1049l") // Exit alt screen
      expect(backend.getMode("altScreen")).toBe(false)
    })

    test("detects bracketed paste mode", () => {
      backend = createBackend()
      expect(backend.getMode("bracketedPaste")).toBe(false)
      feedText(backend, "\x1b[?2004h") // Enable bracketed paste
      expect(backend.getMode("bracketedPaste")).toBe(true)
    })

    test("detects auto wrap mode", () => {
      backend = createBackend()
      // Auto wrap is ON by default
      expect(backend.getMode("autoWrap")).toBe(true)
    })

    test("detects application keypad mode (DEC mode 66)", () => {
      backend = createBackend()
      expect(backend.getMode("applicationKeypad")).toBe(false)
      feedText(backend, "\x1b[?66h") // Enable DECNKM (DEC private mode 66)
      expect(backend.getMode("applicationKeypad")).toBe(true)
      feedText(backend, "\x1b[?66l") // Disable DECNKM
      expect(backend.getMode("applicationKeypad")).toBe(false)
    })
  })

  describe("scrollback", () => {
    test("reports scrollback state", () => {
      backend = createBackend(20, 5)
      const state = backend.getScrollback()
      expect(state.screenLines).toBe(5)
      expect(state.totalLines).toBeGreaterThanOrEqual(5)
    })

    test("accumulates scrollback lines", () => {
      backend = createBackend(20, 3)
      // Write more lines than screen height to generate scrollback
      for (let i = 0; i < 10; i++) {
        feedText(backend, `Line ${i}\r\n`)
      }
      const state = backend.getScrollback()
      expect(state.totalLines).toBeGreaterThan(3)
    })

    // @failure The adapter reports a bottom-pinned viewport and drops scrollViewport, so a viewport probe reads a
    // frozen position (#31392). The tests above only count rows and never move the viewport.
    // @level l1 @consumer TerminalBackend.getScrollback and scrollViewport through the real WASM engine
    test("moves and reports the engine viewport while absolute reads stay put (#31392)", () => {
      backend = createBackend(20, 3)
      for (let i = 0; i < 10; i++) feedText(backend, `Line ${i}\r\n`)
      const text = backend.getText()
      const bottom = backend.getScrollback()
      expect(bottom.totalRows).toBeGreaterThan(bottom.screenRows)
      expect(bottom.viewportTop).toBe(bottom.totalRows - bottom.screenRows)
      const at = (viewportTop: number) => {
        const state = backend.getScrollback()
        expect(state).toMatchObject({ viewportTop, totalRows: bottom.totalRows, screenRows: 3 })
        expect(state).toMatchObject({ viewportOffset: viewportTop, totalLines: bottom.totalRows, screenLines: 3 })
        expect(backend.getText()).toBe(text)
      }

      backend.scrollViewport(-1)
      at(bottom.viewportTop - 1)
      backend.scrollViewport(1)
      at(bottom.viewportTop)
      backend.scrollViewport(-2147483647)
      at(0)
      backend.scrollViewport(2)
      at(2)
      backend.scrollViewport(2147483647)
      at(bottom.viewportTop)
      for (const invalid of [-2147483648, 2147483648, 0.5, Number.NaN]) {
        expect(() => backend.scrollViewport(invalid)).toThrow(RangeError)
      }
      at(bottom.viewportTop)
    })

    // @failure The bridge caches a viewport across screen changes, so alternate screen, reset or resize report stale
    // rows (#31392). The engine owns this state; the adapter must only read it.
    // @level l1 @consumer TerminalBackend.getScrollback through the real WASM engine
    test("reads the engine viewport across alternate screen, output, resize and reset (#31392)", () => {
      backend = createBackend(20, 3)
      for (let i = 0; i < 10; i++) feedText(backend, `Line ${i}\r\n`)
      backend.scrollViewport(-2)
      feedText(backend, "\x1b[?1049h")
      expect(backend.getScrollback()).toMatchObject({ viewportTop: 0, totalRows: 3, screenRows: 3 })
      feedText(backend, "\x1b[?1049l")
      const primary = backend.getScrollback()
      expect(primary.totalRows).toBeGreaterThan(3)
      expect(primary.viewportTop).toBeGreaterThanOrEqual(0)
      expect(primary.viewportTop).toBeLessThanOrEqual(primary.totalRows - 3)

      // Output while scrolled: whether the engine snaps to the bottom or holds is the engine's; only bounds are fixed.
      backend.scrollViewport(-2)
      feedText(backend, "more\r\n")
      const after = backend.getScrollback()
      expect(after.viewportTop).toBeGreaterThanOrEqual(0)
      expect(after.viewportTop).toBeLessThanOrEqual(after.totalRows - 3)

      backend.resize(20, 5)
      const resized = backend.getScrollback()
      expect(resized.screenRows).toBe(5)
      expect(resized.viewportTop).toBeLessThanOrEqual(resized.totalRows - 5)

      backend.reset()
      const reset = backend.getScrollback()
      expect(reset.viewportTop).toBe(reset.totalRows - reset.screenRows)
    })
  })

  describe("resize", () => {
    // @failure ReleaseSmall WASM reuses unzeroed pages, exposing junk in widened history padding (#32121).
    // @level l1 @consumer TerminalBackend.getLine after history reflow through the real WASM engine.
    // Existing resize coverage reads viewport text only; this retains the reported c669 seed in history.
    test("preserves seeded history and blank padding when growing from 12 to 20 columns", () => {
      backend = createBackend(80, 24)
      const clear = "\x1b[?1049l\x1b[?7h\x1b[2J\x1b[H"
      // Replay the retained main-screen phases before history-grow: reset recycles their WASM pages.
      for (const [from, to] of [
        [12, 20],
        [20, 12],
      ] as const) {
        backend.resize(from, 24)
        feedText(backend, `${clear}${"W".repeat(from)}Z`)
        backend.getLines()
        feedText(backend, `${clear}ABCDEFGHIJKLMNOPQR\r\nHARD-a\r\nHARD-b\r\n\x1b[22;1H`)
        backend.getLines()
        backend.resize(to, 24)
        backend.getLines()
        feedText(backend, `${clear}${"W".repeat(to)}Z`)
        backend.getLines()
      }
      backend.reset()
      backend.resize(12, 24)
      backend.getLines()
      feedText(backend, `${clear}WWWWWWWWWWWWZ`)
      backend.getLines()
      feedText(backend, clear)
      const seed = [
        "ABCDEFGHIJKLMNOPQR",
        "HARD-a",
        "HARD-b",
        ...Array.from({ length: 48 }, (_, i) => `R${String(i).padStart(3, "0")}`),
      ]
      feedText(backend, seed.join("\r\n"))
      const before = backend.getScrollback()
      expect(before.totalRows).toBeGreaterThan(24)
      expect(
        backend
          .getLine(0)
          .map((cell) => cell.char)
          .join(""),
      ).toBe("ABCDEFGHIJKL")
      backend.resize(20, 24)
      expect(backend.getScrollback().totalRows).toBe(seed.length)
      for (const [row, text] of seed.entries()) {
        const cells = backend.getLine(row)
        expect(
          cells
            .slice(0, text.length)
            .map((cell) => cell.char)
            .join(""),
          `seed row ${row}`,
        ).toBe(text)
        expect(
          cells
            .slice(text.length)
            .map((cell) => cell.char)
            .join(""),
          `blank padding row ${row}`,
        ).toMatch(/^ *$/)
      }
    })

    test("resizes terminal", () => {
      backend = createBackend(40, 10)
      feedText(backend, "Before resize")
      backend.resize(80, 24)
      feedText(backend, "\r\nAfter resize")
      const text = backend.getText()
      expect(text).toContain("Before resize")
      expect(text).toContain("After resize")
    })
  })

  describe("reset", () => {
    test("clears screen content", () => {
      backend = createBackend()
      feedText(backend, "Some content")
      backend.reset()
      const text = backend.getText()
      expect(text).not.toContain("Some content")
    })

    test("observes .window_title across OSC 0, OSC 2, and full reset while keeping .title_push/.title_pop unimplemented (#31735)", () => {
      backend = createBackend()
      expect(backend.getTitle()).toBe("")
      feedText(backend, "\x1b]0;osc0-title\x07")
      expect(backend.getTitle()).toBe("osc0-title")
      feedText(backend, "\x1b]2;osc2-title\x1b\\")
      expect(backend.getTitle()).toBe("osc2-title")
      // Upstream Ghostty 5714ed07 stream_handler.zig:343-346 marks .title_push/.title_pop Unimplemented
      feedText(backend, "\x1b[22;0t\x1b]2;after-push\x07\x1b[23;0t")
      expect(backend.getTitle()).toBe("after-push")
      feedText(backend, "\x1bc")
      expect(backend.getTitle()).toBe("")
      feedText(backend, "\x1b]2;before-reset\x07")
      expect(backend.getTitle()).toBe("before-reset")
      backend.reset()
      expect(backend.getTitle()).toBe("")
    })
  })

  /**
   * @failure #32272: Ghostty emits every OSC 9/777 toast and OSC 9;4 report as actions (5714ed07 stream.zig:2081-2086,
   * 2101-2102), but our WASM API patch dropped both in its no-effect arm, so no reader saw what Ghostty parsed.
   * @consumer Terminfo extensions.notifications, extensions.osc777-notify and extensions.osc9-progress through
   * osc-metadata getToasts and getProgress
   */
  describe("stored OSC actions", () => {
    // @failure A stale distribution pretends an expected reader is absent, or an engine error becomes null.
    // @consumer OscMetadataExtension.getCwd; successful engine feeds cannot force these failure paths.
    test("rejects a stale directory reader and propagates lookup errors", () => {
      const own = createGhosttyBackend(undefined, ghostty)
      const raw = ghostty.createTerminal(20, 3)
      const create = vi.spyOn(ghostty, "createTerminal").mockReturnValueOnce(raw)
      try {
        own.init({ cols: 20, rows: 3 })
        const failure = new Error("directory lookup failed")
        const lookup = vi.spyOn(raw, "getCwd").mockImplementationOnce(() => { throw failure })
        expect(() => own.getCwd()).toThrow(failure)
        lookup.mockRestore()
        Object.defineProperty(raw, "getCwd", { value: undefined })
        expect(() => own.getCwd()).toThrow(/predates getCwd; rebuild it: nix develop/)
      } finally {
        create.mockRestore()
        own.destroy()
      }
    })

    // @failure OSC 7 report_pwd is discarded before the engine's directory store reaches the reader.
    // @consumer OscMetadataExtension / Terminfo extensions.osc7-cwd and extensions.osc633-p.
    // Title and notification journeys do not observe directory state or its borrowed UTF-8 lifetime.
    test("forwards the engine directory store literally across framing, resets and independent instances", () => {
      const own = createGhosttyBackend(undefined, ghostty)
      const other = createGhosttyBackend(undefined, ghostty)
      expect(() => own.getCwd()).toThrow("not initialized")
      own.init({ cols: 20, rows: 3 })
      other.init({ cols: 20, rows: 3 })
      try {
        expect(own.getCwd()).toBeNull()
        const literal = "file://remote/窓;dir\\raw%20name"
        feedText(own, `\x1b]7;${literal}\x07`)
        const retained = own.getCwd()
        expect(retained).toBe(literal)
        expect(other.getCwd()).toBeNull()
        feedText(own, "\x1b]7;file:///split")
        expect(own.getCwd()).toBe(literal)
        // This core dispatches OSC at ESC; the following ST backslash does not alter the value.
        feedText(own, "\x1b")
        expect(own.getCwd()).toBe("file:///split")
        feedText(own, "\\")
        expect(own.getCwd()).toBe("file:///split")
        for (const sequence of ["\x1b]633;P;Cwd=/ignored\x07", "\x1b]633;P;Cwd=/ignored\x1b\\", "\x1b]633;A\x07"]) {
          feedText(own, sequence)
          expect(own.getCwd()).toBe("file:///split")
        }
        feedText(own, `\x1b]7;${"x".repeat(4097)}\x07`)
        expect(own.getCwd()).toBe("file:///split")
        feedText(own, "\x1b]7;\x07")
        expect(own.getCwd()).toBeNull()
        own.feed(new Uint8Array([27, 93, 55, 59, 102, 105, 108, 101, 58, 47, 47, 47, 255, 7]))
        expect(() => own.getCwd()).toThrow(TypeError)
        feedText(own, `\x1b]7;${literal}\x1b\\`)
        expect(own.getCwd()).toBe(literal)
        own.reset()
        expect(own.getCwd()).toBeNull()
        feedText(own, "\x1b]7;file:///before-ris\x07\x1bc")
        expect(own.getCwd()).toBeNull()
        feedText(own, "\x1b]7;file:///before-init\x07")
        own.init({ cols: 20, rows: 3 })
        expect(own.getCwd()).toBeNull()
        expect(retained).toBe(literal)
      } finally {
        own.destroy()
        other.destroy()
      }
      expect(() => own.getCwd()).toThrow("not initialized")
    })

    test("stores every engine-emitted toast verbatim and in order; init empties it, reset keeps it", () => {
      const own = createGhosttyBackend(undefined, ghostty)
      own.init({ cols: 20, rows: 3 })
      try {
        expect(own.capabilities.extensions.has("osc-metadata")).toBe(true)
        expect(own.getToasts()).toEqual([])
        // Non-toast sequences of both families store nothing: ConEmu progress, and an rxvt extension other than notify.
        feedText(own, "\x1b]9;4;0\x07\x1b]777;preexec\x07")
        expect(own.getToasts()).toEqual([])
        // Ghostty requires the title separator for 777 notify (osc.zig:1065-1074, 1709-1715), so this stores nothing.
        feedText(own, "\x1b]777;notify;lonely\x07")
        expect(own.getToasts()).toEqual([])
        feedText(own, "\x1b]9;nine body\x07")
        feedText(own, "\x1b]777;notify;T777;B777\x1b\\")
        feedText(own, "\x1b]777;notify;;empty title 窓\x07X")
        // OSC 9 builds title "" (osc.zig:1398-1409); 777 keeps its title, an empty one stays "".
        const toasts = own.getToasts()
        expect(toasts).toEqual([
          { title: "", body: "nine body" },
          { title: "T777", body: "B777" },
          { title: "", body: "empty title 窓" },
        ])
        toasts[0]!.body = "mutated"
        // The type is readonly; the runtime array is a copy the caller may change without touching the store.
        ;(toasts as { title: string | null; body: string }[]).pop()
        expect(own.getToasts()).toHaveLength(3)
        expect(own.getToasts()[0]).toEqual({ title: "", body: "nine body" })
        expect(own.getCell(0, 0).char).toBe("X")
        // A terminal reset does not unsend a notification (@cto b8d28548).
        own.reset()
        feedText(own, "\x1bc")
        expect(own.getToasts()).toHaveLength(3)
        own.init({ cols: 20, rows: 3 })
        expect(own.getToasts()).toEqual([])
      } finally {
        own.destroy()
      }
      expect(() => own.getToasts()).toThrow("not initialized")
    })

    test("reads the engine-emitted OSC 9;4 report verbatim, null before the first; init empties it, reset keeps it", () => {
      const own = createGhosttyBackend(undefined, ghostty)
      own.init({ cols: 20, rows: 3 })
      try {
        expect(own.getProgress()).toBeNull()
        feedText(own, "\x1b]9;4;1;37\x07")
        const first = own.getProgress()
        expect(first).toEqual({ state: 1, value: 37 })
        first!.value = 99
        expect(own.getProgress()).toEqual({ state: 1, value: 37 })
        feedText(own, "\x1b]9;4;2;64\x07")
        expect(own.getProgress()).toEqual({ state: 2, value: 64 })
        // Indeterminate and remove drop any value (osc.zig:1186-1282): stored as none, read as null.
        feedText(own, "\x1b]9;4;3\x1b\\")
        expect(own.getProgress()).toEqual({ state: 3, value: null })
        feedText(own, "\x1b]9;4;4;150\x07")
        // Ghostty clamps a value to 100 before storing it.
        expect(own.getProgress()).toEqual({ state: 4, value: 100 })
        feedText(own, "\x1b]9;4;0\x07X")
        expect(own.getProgress()).toEqual({ state: 0, value: null })
        expect(own.getCell(0, 0).char).toBe("X")
        expect(own.getToasts()).toEqual([])
        own.reset()
        expect(own.getProgress()).toEqual({ state: 0, value: null })
        own.init({ cols: 20, rows: 3 })
        expect(own.getProgress()).toBeNull()
      } finally {
        own.destroy()
      }
      expect(() => own.getProgress()).toThrow("not initialized")
    })
  })

  describe("key encoding", () => {
    // @failure The declared runtime enums are erased, or the qualified adapter returns host-encoded bytes.
    // @level l0 @consumer KeyEncodingExtension / terminfo input.xtest-key.
    // Existing byte-only cases pass for the host helper and cannot establish native encoder ownership.
    test("exports the public key enums consumed by native callers", () => {
      const api = ghosttyApi as unknown as Record<string, Record<string, number> | undefined>
      expect({ key: api.Key?.A, action: api.KeyAction?.PRESS, mods: api.Mods?.CTRL }).toEqual({
        key: 20,
        action: 1,
        mods: 2,
      })
    })

    test("delegates to the native encoder, propagates errors and disposes each lifecycle", () => {
      const create = vi.spyOn(ghostty, "createKeyEncoder")
      const encode = vi.spyOn(KeyEncoder.prototype, "encode")
      const dispose = vi.spyOn(KeyEncoder.prototype, "dispose")
      const host = vi.spyOn(hostKeyEncoding, "encodeKeyToAnsi").mockImplementation(() => {
        throw new Error("host encoder must not answer a native key operation")
      })
      const own = createGhosttyBackend(undefined, ghostty)
      try {
        own.init({ cols: 20, rows: 24 })
        expect(create).toHaveBeenCalledTimes(1)
        expect(own.capabilities.extensions.has("key-encoding")).toBe(true)
        expect([...own.encodeKey({ key: "a" })]).toEqual([97])
        expect([...own.encodeKey({ key: "a", ctrl: true })]).toEqual([1])
        // A function-key name is not associated text, even when its enum is found outside the alias map.
        expect([...own.encodeKey({ key: "F1" })]).toEqual([27, 79, 80])
        expect(encode).toHaveBeenLastCalledWith(expect.objectContaining({ key: ghosttyApi.Key.F1, utf8: undefined }))
        for (const [key, nativeKey] of [
          ["CapsLock", ghosttyApi.Key.CAPS_LOCK],
          ["ContextMenu", ghosttyApi.Key.CONTEXT_MENU],
          ["NumLock", ghosttyApi.Key.NUM_LOCK],
          ["FnLock", ghosttyApi.Key.FN_LOCK],
          ["PrintScreen", ghosttyApi.Key.PRINT_SCREEN],
          ["ScrollLock", ghosttyApi.Key.SCROLL_LOCK],
          ["Pause", ghosttyApi.Key.PAUSE],
          ["MediaPlayPause", ghosttyApi.Key.MEDIA_PLAY_PAUSE],
        ] as const) {
          own.encodeKey({ key })
          expect(encode).toHaveBeenLastCalledWith(expect.objectContaining({ key: nativeKey, utf8: undefined }))
        }
        expect(encode).toHaveBeenCalledTimes(11)
        expect(host).not.toHaveBeenCalled()
        const failure = new Error("native encoder failed")
        encode.mockImplementationOnce(() => {
          throw failure
        })
        expect(() => own.encodeKey({ key: "a" })).toThrow(failure)
        own.init({ cols: 20, rows: 24 })
        expect(create).toHaveBeenCalledTimes(2)
        expect(dispose).toHaveBeenCalledTimes(1)
        own.destroy()
        expect(dispose).toHaveBeenCalledTimes(2)
        expect(() => own.encodeKey({ key: "a" })).toThrow(/not initialized/)
        expect(host).not.toHaveBeenCalled()
      } finally {
        own.destroy()
        host.mockRestore()
        dispose.mockRestore()
        encode.mockRestore()
        create.mockRestore()
      }
    })

    // @failure A native encoder creation error leaves an allocated terminal live after partial init.
    // @level l0 @consumer backend init/destroy. Normal lifecycle tests never force allocation failure.
    test("releases a partially initialized terminal when encoder creation fails", () => {
      const created: GhosttyTerminal[] = []
      const originalCreate = ghostty.createTerminal.bind(ghostty)
      const terminals = vi.spyOn(ghostty, "createTerminal").mockImplementation((...args) => {
        const terminal = originalCreate(...args)
        vi.spyOn(terminal, "free")
        created.push(terminal)
        return terminal
      })
      const failure = new Error("native encoder allocation failed")
      const encoders = vi.spyOn(ghostty, "createKeyEncoder").mockImplementationOnce(() => {
        throw failure
      })
      const own = createGhosttyBackend(undefined, ghostty)
      try {
        expect(() => own.init({ cols: 20, rows: 24 })).toThrow(failure)
        for (const terminal of created) expect(terminal.free).toHaveBeenCalledTimes(1)
        expect(() => own.encodeKey({ key: "a" })).toThrow(/not initialized/)
      } finally {
        own.destroy()
        for (const terminal of created) vi.mocked(terminal.free).mockRestore()
        encoders.mockRestore()
        terminals.mockRestore()
      }
    })

    test("encodes Enter", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "Enter" })
      expect(encoded).toEqual(new Uint8Array([0x0d]))
    })

    test("encodes Escape", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "Escape" })
      expect(encoded).toEqual(new Uint8Array([0x1b]))
    })

    test("encodes Ctrl+C", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "c", ctrl: true })
      expect(encoded).toEqual(new Uint8Array([3])) // ETX
    })

    // Printable digits have named native keys too; retaining only their key code drops their text.
    // @failure Native field translation loses printable digit input; existing letter cases miss this branch.
    // @level l0 @consumer KeyEncodingExtension callers sending printable text.
    test.each([..."a0123456789é😀", "👍🏽", "e\u0301"])("encodes regular characters (%s)", (key) => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key })
      expect(encoded).toEqual(new TextEncoder().encode(key))
    })

    test("encodes arrow keys", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "ArrowUp" })
      expect(new TextDecoder().decode(encoded)).toBe("\x1b[A")
    })
  })

  // Accepted requirement (@cto 10:37 ghostty scope G1/G2): the existing shared encoder reads the WASM engine's own
  // per-mode flags; one set flag is exact, several are ambiguous and reported unavailable, never resolved by guess.
  // Existing tests covered key encoding only, so a missing, stale or inferred mouse binding went unseen.
  // @failure The ghostty mouse extension encodes reset/ambiguous modes, or X10 tracking reads as off.
  // @level l0
  // @consumer terminfo library mouse arms (mouseEncodingLib) reading getMode("mouseTracking") then encodeMouse.
  describe("mouse encoding", () => {
    const reset = "\x1b[?9;1000;1002;1003;1005;1006;1015;1016l"
    const event = { x: 4, y: 2, button: "left", action: "press" } as const
    const encode = (b: TerminalBackend, e: MouseEvent) => (b as TerminalBackend & MouseEncodingExtension).encodeMouse(e)

    test.each([
      ["\x1b[?9h", event, "\x1b[M %#"],
      ["\x1b[?1000h\x1b[?1006h", event, "\x1b[<0;5;3M"],
      ["\x1b[?1000h\x1b[?1006h", { ...event, button: "wheelUp" }, "\x1b[<64;5;3M"],
      ["\x1b[?1002h\x1b[?1006h", { ...event, action: "move" }, "\x1b[<32;5;3M"],
      ["\x1b[?1000h\x1b[?1015h", event, "\x1b[32;5;3M"],
      ["\x1b[?1000h\x1b[?1005h", { ...event, x: 200 }, "\x1b[M \u00e9#"],
      ["\x1b[?1000h\x1b[?1016h", { ...event, pixel: { x: 40, y: 24 } }, "\x1b[<0;41;25M"],
    ] as const)("encodes the engine's own mode flags %j", (setup, mouse, report) => {
      backend = createBackend(300, 24)
      expect(backend.capabilities.extensions.has("mouse-encoding")).toBe(true)
      feedText(backend, reset)
      expect(backend.getMode("mouseTracking")).toBe(false)
      expect(encode(backend, mouse)).toBeNull()
      feedText(backend, setup)
      expect(backend.getMode("mouseTracking")).toBe(true)
      expect(new TextDecoder().decode(encode(backend, mouse)!)).toBe(report)
      feedText(backend, reset)
      expect(encode(backend, mouse)).toBeNull()
    })

    test("reports ambiguous or incomplete engine state as unavailable, never a guessed report", () => {
      backend = createBackend()
      feedText(backend, "\x1b[?1000h\x1b[?1002h")
      expect(() => encode(backend, event)).toThrow("mouse encoding unavailable: tracking modes 1000+1002 all set")
      feedText(backend, `${reset}\x1b[?1000h\x1b[?1006h\x1b[?1015h`)
      expect(() => encode(backend, event)).toThrow("mouse encoding unavailable: encoding modes 1006+1015 all set")
      feedText(backend, `${reset}\x1b[?1000h\x1b[?1016h`)
      expect(() => encode(backend, event)).toThrow("mouse encoding unavailable: SGR-pixel needs pixel coordinates")
      // X10 reports presses only.
      feedText(backend, `${reset}\x1b[?9h`)
      expect(encode(backend, { ...event, action: "release" })).toBeNull()
    })
  })

  describe("capabilities", () => {
    test("reports ghostty capabilities", () => {
      backend = createBackend()
      expect(backend.capabilities.name).toBe("ghostty")
      expect(backend.capabilities.truecolor).toBe(true)
      expect(backend.capabilities.kittyKeyboard).toBe(true)
      expect(backend.capabilities.reflow).toBe(true)
    })
  })
})
