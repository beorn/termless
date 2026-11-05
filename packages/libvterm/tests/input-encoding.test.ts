/**
 * @failure Native input ignores terminal modes, steals queued replies, or replaces the OSC52 selection owner.
 * @level l1
 * @consumer TerminalBackend input encoding and raw LibvtermModule keyboard/mouse/paste callers.
 * @testonly none
 */
import { expect, test, vi } from "vitest"
import * as hostKeyEncoding from "../../../src/terminal/key-encoding.ts"
import { createLibvtermBackend } from "../src/backend.ts"
import { initLibvterm, type LibvtermModule } from "../src/wasm-bindings.ts"
import {
  hasExtension,
  type MouseEncodingExtension,
  type PasteEncodingExtension,
  type KeyDescriptor,
  type KeyEncodingExtension,
} from "../../../src/terminal/types.ts"

const module = await initLibvterm()
const encoder = new TextEncoder()
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const query = "\x1b]52;c;?\x07"

function feedNative(m: LibvtermModule, vt: number, text: string): void {
  const bytes = encoder.encode(text)
  const ptr = m._malloc(bytes.length)
  try {
    bytes.forEach((byte, i) => m.setValue(ptr + i, byte, "i8"))
    expect(m.vterm_input_write(vt, ptr, bytes.length)).toBe(bytes.length)
  } finally {
    m._free(ptr)
  }
}

function drainNative(m: LibvtermModule, sink: number, limit = 1024): string {
  const ptr = m._malloc(limit)
  try {
    const n = m.termless_vterm_output_read(sink, ptr, limit)
    expect(n).toBeGreaterThanOrEqual(0)
    return decode(Uint8Array.from({ length: n }, (_, i) => m.getValue(ptr + i, "i8") & 255))
  } finally {
    m._free(ptr)
  }
}

// The existing mode observer test cannot detect a capture that drains protocol replies or unregisters selections.
test("raw native capture preserves a pending reply prefix and the OSC52 owner", () => {
  const vt = module.vterm_new(3, 8)
  const reply = module.termless_vterm_output_attach(vt)
  try {
    module.vterm_screen_reset(module.vterm_obtain_screen(vt), 1)
    feedNative(module, vt, "\x1b]52;c;aGVsbG8=\x07" + query)
    expect(drainNative(module, reply)).toBe("\x1b]52;c;aGVsbG8=\x1b\\")
    feedNative(module, vt, "\x1b[5n".repeat(400))
    const prefix = drainNative(module, reply)
    expect(prefix).toHaveLength(1024)
    const capture = module.termless_vterm_output_capture_begin(vt)
    expect(capture).not.toBe(0)
    try {
      module.vterm_keyboard_key(vt, 5, 0)
      expect(drainNative(module, capture)).toBe("\x1b[A")
    } finally {
      module.termless_vterm_output_capture_end(vt, reply, capture)
    }
    expect(prefix + drainNative(module, reply)).toBe("\x1b[0n".repeat(400))
    feedNative(module, vt, query)
    expect(drainNative(module, reply)).toBe("\x1b]52;c;aGVsbG8=\x1b\\")
  } finally {
    module.termless_vterm_output_detach(vt, reply)
    module.vterm_free(vt)
  }
})

// Raw handles exercise native boundaries independently of the backend capture and selection owner.
test("raw input APIs follow native keypad and bracketed-paste state", () => {
  const vt = module.vterm_new(3, 8)
  const reply = module.termless_vterm_output_attach(vt)
  try {
    module.vterm_screen_reset(module.vterm_obtain_screen(vt), 1)
    module.vterm_keyboard_key(vt, 512, 0)
    expect(drainNative(module, reply)).toBe("0")
    feedNative(module, vt, "\x1b=")
    module.vterm_keyboard_key(vt, 512, 0)
    expect(drainNative(module, reply)).toBe("\x1bOp")
    feedNative(module, vt, "\x1b>")
    module.vterm_keyboard_key(vt, 512, 0)
    expect(drainNative(module, reply)).toBe("0")
    module.vterm_keyboard_start_paste(vt)
    module.vterm_keyboard_end_paste(vt)
    expect(drainNative(module, reply)).toBe("")
    feedNative(module, vt, "\x1b[?2004h")
    module.vterm_keyboard_start_paste(vt)
    module.vterm_keyboard_end_paste(vt)
    expect(drainNative(module, reply)).toBe("\x1b[200~\x1b[201~")
    feedNative(module, vt, "\x1b[?2004l")
    module.vterm_keyboard_start_paste(vt)
    module.vterm_keyboard_end_paste(vt)
    expect(drainNative(module, reply)).toBe("")
  } finally {
    module.termless_vterm_output_detach(vt, reply)
    module.vterm_free(vt)
  }
})

test("input during a reply callback cannot steal the rest of a multi-chunk response", () => {
  const backend = createLibvtermBackend(undefined, module)
  backend.init({ cols: 8, rows: 3 })
  let replies = ""
  let input = ""
  let paste = ""
  let calls = 0
  backend.onResponse = (bytes) => {
    replies += decode(bytes)
    if (++calls === 1) {
      input = decode(backend.encodeKey({ key: "ArrowUp" }))
      paste = decode(backend.encodePaste("café🦊"))
    }
  }
  try {
    backend.feed(encoder.encode("\x1b[?1h\x1b[?2004h" + "\x1b[5n".repeat(400)))
    expect(input).toBe("\x1bOA")
    expect(paste).toBe("\x1b[200~café🦊\x1b[201~")
    expect(replies).toBe("\x1b[0n".repeat(400))
    expect(calls).toBe(2)
  } finally {
    backend.destroy()
  }
})

// Success-only input tests miss restoration after native failure or either allocation/read boundary fails.
test("capture failures restore replies and selection callbacks before subsequent input and destroy", () => {
  for (const input of ["key", "paste"] as const) {
    for (const failure of ["begin", "allocation", "read", "native"] as const) {
      let armed = false
      let capture = 0
      let ended = 0
      const injected: LibvtermModule = {
        ...module,
        termless_vterm_output_capture_begin(vt) {
          if (armed && failure === "begin") return 0
          capture = module.termless_vterm_output_capture_begin(vt)
          return capture
        },
        termless_vterm_output_capture_end(vt, reply, sink) {
          ++ended
          module.termless_vterm_output_capture_end(vt, reply, sink)
        },
        _malloc(size) {
          return armed && failure === "allocation" ? 0 : module._malloc(size)
        },
        termless_vterm_output_read(sink, ptr, size) {
          return armed && failure === "read" && sink === capture
            ? -1
            : module.termless_vterm_output_read(sink, ptr, size)
        },
        vterm_keyboard_unichar(vt, codepoint, mods) {
          module.vterm_keyboard_unichar(vt, codepoint, mods)
          if (armed && failure === "native") throw new Error("injected native input failure")
        },
        vterm_keyboard_key(vt, key, mods) {
          module.vterm_keyboard_key(vt, key, mods)
          if (armed && failure === "native") throw new Error("injected native input failure")
        },
      }
      const backend = createLibvtermBackend(undefined, injected)
      backend.init({ cols: 8, rows: 3 })
      let replies = ""
      backend.onResponse = (bytes) => {
        replies += decode(bytes)
      }
      try {
        backend.feed(encoder.encode("\x1b]52;c;aGVsbG8=\x07" + query))
        expect(replies).toBe("\x1b]52;c;aGVsbG8=\x1b\\")
        replies = ""
        armed = true
        expect(
          () => (input === "key" ? backend.encodeKey({ key: "ArrowUp" }) : backend.encodePaste("hello")),
          failure,
        ).toThrow(failure === "native" ? /injected native input failure/ : /libvterm input capture/)
        armed = false
        expect(ended, failure).toBe(failure === "begin" ? 0 : 1)
        backend.feed(encoder.encode("\x1b[5n" + query))
        expect(replies, failure).toBe("\x1b[0n\x1b]52;c;aGVsbG8=\x1b\\")
        expect(decode(backend.encodeKey({ key: "ArrowDown" }))).toBe("\x1b[B")
        expect(replies).toBe("\x1b[0n\x1b]52;c;aGVsbG8=\x1b\\")
        backend.destroy()
        backend.init({ cols: 8, rows: 3 })
        replies = ""
        backend.feed(encoder.encode(query))
        expect(replies).toBe("\x1b]52;c;\x1b\\")
      } finally {
        armed = false
        backend.destroy()
      }
    }
  }
})

// Legacy presence and matching bytes miss host encoding; each accepted path must call native input inside capture.
test("key descriptors follow native modifier semantics and classify text once", () => {
  const calls: ["key" | "text", number, number][] = []
  let capturing = false
  const injected: LibvtermModule = {
    ...module,
    termless_vterm_output_capture_begin(vt) {
      const capture = module.termless_vterm_output_capture_begin(vt)
      capturing = capture !== 0
      return capture
    },
    termless_vterm_output_capture_end(vt, reply, capture) {
      module.termless_vterm_output_capture_end(vt, reply, capture)
      capturing = false
    },
    vterm_keyboard_key(vt, key, mods) {
      expect(capturing).toBe(true)
      calls.push(["key", key, mods])
      module.vterm_keyboard_key(vt, key, mods)
    },
    vterm_keyboard_unichar(vt, codepoint, mods) {
      expect(capturing).toBe(true)
      calls.push(["text", codepoint, mods])
      module.vterm_keyboard_unichar(vt, codepoint, mods)
    },
  }
  const hostEncoder = vi.spyOn(hostKeyEncoding, "encodeKeyToAnsi")
  const backend = createLibvtermBackend(undefined, injected)
  backend.init({ cols: 8, rows: 3 })
  try {
    expect(hasExtension<KeyEncodingExtension>(backend, "key-encoding")).toBe(true)
    const cases: [KeyDescriptor, string, "key" | "text", number, number][] = [
      [{ key: "Enter" }, "\r", "key", 1, 0],
      [{ key: "Enter", ctrl: true }, "\x1b[13;5u", "key", 1, 4],
      [{ key: "Enter", shift: true }, "\x1b[13;2u", "key", 1, 1],
      [{ key: "Backspace", ctrl: true }, "\x1b[127;5u", "key", 3, 4],
      [{ key: "Tab", shift: true }, "\x1b[Z", "key", 2, 1],
      [{ key: "F1", ctrl: true }, "\x1b[1;5P", "key", 257, 4],
      [{ key: "Space", shift: true }, "\x1b[32;2u", "text", 32, 1],
      [{ key: "a", ctrl: true }, "\x01", "text", 97, 4],
      [{ key: "x", alt: true }, "\x1bx", "text", 120, 2],
      [{ key: "🦊" }, "🦊", "text", 0x1f98a, 0],
      [{ key: "hello" }, "hello", "text", 104, 0],
      [{ key: "UnknownKey" }, "UnknownKey", "text", 85, 0],
      [{ key: "café🦊" }, "café🦊", "text", 99, 0],
    ]
    for (const [key, expected, kind, firstCode, mods] of cases) {
      calls.length = 0
      expect(decode(backend.encodeKey(key)), JSON.stringify(key)).toBe(expected)
      const codes =
        kind === "text" && key.key !== "Space" ? Array.from(key.key, (scalar) => scalar.codePointAt(0)!) : [firstCode]
      expect(calls, JSON.stringify(key)).toEqual(codes.map((code) => [kind, code, mods]))
      expect(capturing).toBe(false)
    }
    for (const key of [{ key: "ab", ctrl: true }, { key: "F13" }, { key: "x", super: true }, { key: "Meta" }]) {
      calls.length = 0
      expect(() => backend.encodeKey(key)).toThrow(/libvterm.*no native encoding/i)
      expect(calls).toEqual([])
    }
    backend.feed(encoder.encode("\x1b[20h"))
    calls.length = 0
    expect(decode(backend.encodeKey({ key: "Enter" }))).toBe("\r\n")
    expect(calls).toEqual([["key", 1, 0]])
    expect(hostEncoder).not.toHaveBeenCalled()
  } finally {
    backend.destroy()
    hostEncoder.mockRestore()
  }
  expect(() => backend.encodeKey({ key: "a" })).toThrow(/not initialized/i)
})

test("native mouse encoding follows tracking state, coordinates and protocols", () => {
  const backend = createLibvtermBackend(undefined, module)
  backend.init({ cols: 80, rows: 24 })
  try {
    expect(hasExtension<MouseEncodingExtension>(backend, "mouse-encoding")).toBe(true)
    if (!hasExtension<MouseEncodingExtension>(backend, "mouse-encoding")) {
      throw new Error("libvterm mouse extension missing")
    }
    const event = { x: 4, y: 2, button: "left" as const, action: "press" as const }
    expect(backend.encodeMouse(event)?.length ?? 0).toBe(0)
    expect(backend.encodeMouse({ ...event, action: "release" })?.length ?? 0).toBe(0)
    backend.reset()
    backend.feed(encoder.encode("\x1b[?1000h\x1b[?1006h"))
    expect(decode(backend.encodeMouse(event)!)).toBe("\x1b[<0;5;3M")
    expect(decode(backend.encodeMouse({ ...event, action: "release" })!)).toBe("\x1b[<0;5;3m")
    expect(decode(backend.encodeMouse({ ...event, button: "wheelUp", ctrl: true })!)).toBe("\x1b[<80;5;3M")
    expect(() => backend.encodeMouse({ ...event, pixel: { x: 4, y: 2 } })).toThrow(/libvterm.*pixel/i)
    backend.feed(encoder.encode("\x1b[?1003h"))
    expect(decode(backend.encodeMouse({ ...event, x: 5 })!)).toBe("\x1b[<35;6;3M\x1b[<0;6;3M")
    expect(backend.encodeMouse({ ...event, x: 5 })?.length ?? 0).toBe(0)
    // Each native format has different byte coordinates; no shared SGR encoder can satisfy these rows.
    for (const [mode, x, expected] of [
      ["", 4, "\x1b[M %#"],
      ["\x1b[?1005h", 300, "\x1b[M \u014d#"],
      ["\x1b[?1015h", 4, "\x1b[0;5;3M"],
    ] as const) {
      backend.init({ cols: 80, rows: 24 })
      backend.feed(encoder.encode("\x1b[?1000h" + mode))
      expect(decode(backend.encodeMouse({ ...event, x })!)).toBe(expected)
    }
    backend.init({ cols: 80, rows: 24 })
    backend.feed(encoder.encode("\x1b[?1002h\x1b[?1006h"))
    expect(backend.encodeMouse({ ...event, button: "none", action: "move" })).toBeNull()
    expect(decode(backend.encodeMouse(event)!)).toBe("\x1b[<0;5;3M")
    expect(decode(backend.encodeMouse({ ...event, x: 5, action: "move" })!)).toBe("\x1b[<32;6;3M")
    expect(decode(backend.encodeMouse({ ...event, x: 5, action: "release" })!)).toBe("\x1b[<0;6;3m")
    expect(decode(backend.encodeMouse({ ...event, x: 5, button: "wheelDown" })!)).toBe("\x1b[<65;6;3M")
  } finally {
    backend.destroy()
  }
})

// Raw boundary tests miss routing text through this instance's native modes and Unicode input API.
test("backend paste encoding follows current native bracketed-paste mode without parsing text", () => {
  const backend = createLibvtermBackend(undefined, module)
  backend.init({ cols: 20, rows: 3 })
  let replies = ""
  backend.onResponse = (bytes) => {
    replies += decode(bytes)
  }
  try {
    expect(hasExtension<PasteEncodingExtension>(backend, "paste-encoding")).toBe(true)
    const text = "café🦊\t\n\x1b[5n"
    for (const [mode, expected] of [
      ["\x1b[?2004l", text],
      ["\x1b[?2004h", "\x1b[200~" + text + "\x1b[201~"],
      ["\x1b[?2004l", text],
    ] as const) {
      backend.feed(encoder.encode(mode))
      expect(backend.encodePaste(text)).toEqual(encoder.encode(expected))
      expect(replies).toBe("")
      expect(backend.getText()).toBe("\n\n")
    }
    expect(backend.encodePaste("")).toEqual(new Uint8Array())
    backend.feed(encoder.encode("\x1b[?2004h"))
    expect(decode(backend.encodePaste(""))).toBe("\x1b[200~\x1b[201~")
  } finally {
    backend.destroy()
  }
  expect(() => backend.encodePaste("text")).toThrow(/not initialized/i)
})

// A native text exception must still finish paste; a second cleanup failure must not mask the first.
test("paste cleanup restores response and OSC52 owners and preserves native failures", () => {
  for (const failure of ["start", "text", "end", "text-and-end"] as const) {
    let armed = false
    let ended = 0
    const primary = new Error("injected native paste failure")
    const cleanup = new Error("injected native paste cleanup failure")
    const injected: LibvtermModule = {
      ...module,
      vterm_keyboard_start_paste(vt) {
        module.vterm_keyboard_start_paste(vt)
        if (armed && failure === "start") throw primary
      },
      vterm_keyboard_unichar(vt, codepoint, mods) {
        module.vterm_keyboard_unichar(vt, codepoint, mods)
        if (armed && (failure === "text" || failure === "text-and-end")) throw primary
      },
      vterm_keyboard_end_paste(vt) {
        ++ended
        module.vterm_keyboard_end_paste(vt)
        if (armed && (failure === "end" || failure === "text-and-end")) throw cleanup
      },
    }
    const backend = createLibvtermBackend(undefined, injected)
    backend.init({ cols: 8, rows: 3 })
    let replies = ""
    backend.onResponse = (bytes) => {
      replies += decode(bytes)
    }
    try {
      backend.feed(encoder.encode("\x1b[?2004h\x1b]52;c;aGVsbG8=\x07"))
      armed = true
      let caught: unknown
      try {
        backend.encodePaste("abc")
      } catch (error) {
        caught = error
      }
      if (failure === "text-and-end") {
        expect(caught).toBeInstanceOf(AggregateError)
        expect((caught as AggregateError).errors).toEqual([primary, cleanup])
      } else expect(caught).toBe(failure === "end" ? cleanup : primary)
      expect(ended).toBe(1)
      armed = false
      backend.feed(encoder.encode("\x1b[5n" + query))
      expect(replies).toBe("\x1b[0n\x1b]52;c;aGVsbG8=\x1b\\")
      expect(decode(backend.encodePaste("ok"))).toBe("\x1b[200~ok\x1b[201~")
      expect(replies).toBe("\x1b[0n\x1b]52;c;aGVsbG8=\x1b\\")
    } finally {
      armed = false
      backend.destroy()
    }
  }
})
