/**
 * @failure Engine-delivered CWD, OSC 9/777 notifications or OSC 52 selection callbacks disappear, join interrupted strings, or leak across instance lifecycles.
 * @level l1
 * @consumer Terminfo OSC 9 notifications and OSC 52 clipboard criteria through real libvterm WASM and TerminalBackend.
 * @testonly none
 */
import { describe, expect, test } from "vitest"
import { hasExtension, type OscMetadataExtension } from "../../../src/terminal/types.ts"
import { createLibvtermBackend } from "../src/backend.ts"
import { initLibvterm } from "../src/wasm-bindings.ts"

const module = await initLibvterm()
const encoder = new TextEncoder()
const query = "\x1b]52;c;?\x07"

// Accepted CWD contract: notification/selection tests never read directory state,
// so cannot catch missing forwarding, premature fragment commits or lossy decoding.
describe("callback-backed working directory", () => {
  function cwd(backend: ReturnType<typeof createLibvtermBackend>): () => string | null {
    if (!hasExtension<OscMetadataExtension>(backend, "osc-metadata") || !backend.getCwd) {
      throw new Error("libvterm must expose engine-delivered CWD")
    }
    return () => backend.getCwd!()
  }

  test("commits only complete 7/633 Cwd payloads and keeps literal callback bytes", () => {
    const backend = createLibvtermBackend(undefined, module)
    try {
      backend.init({ cols: 80, rows: 24 })
      const read = cwd(backend)
      expect(read()).toBeNull()
      for (const [command, payload, expected] of [
        [7, "file://remote/窓;dir\\raw%20", "file://remote/窓;dir\\raw%20"],
        [633, "P;Cwd=/from633", "/from633"],
        [633, "P;Other=ignored", "/from633"],
        [633, "A", "/from633"],
        [633, "P;Cwd=\uFEFF/literal", "\uFEFF/literal"],
        [7, "/".repeat(4097), "/".repeat(4097)],
      ] as const) {
        const previous = read()
        const bytes = encoder.encode(`\x1b]${command};${payload}\x1b\\`)
        for (const byte of bytes.subarray(0, -1)) backend.feed(Uint8Array.of(byte))
        expect(read()).toBe(previous) // Even the lone ESC is not a completed ST.
        backend.feed(bytes.subarray(-1))
        expect(read()).toBe(expected)
      }
      for (const abort of ["\x18", "\x1a"]) {
        backend.feed(encoder.encode(`\x1b]633;P;Cwd=/aborted${abort}`))
        expect(read()).toBe("/".repeat(4097))
      }
      backend.feed(encoder.encode("\x1b]7;/a\0b\x7fc\x07\x1b]633;A\x07\x1b]9;nine\x07\x1b]777;seven\x07"))
      expect(read()).toBe("/abc") // Native parser strips NUL and DEL across fragments.
      expect(backend.getNotifications?.()).toEqual(["nine"])
      expect(backend.getOsc777Payloads?.()).toEqual(["seven"])
    } finally {
      backend.destroy()
    }
  })

  test("empty reports clear, RIS retains, and reset/re-init isolate observer lifetimes", () => {
    const backend = createLibvtermBackend(undefined, module)
    const other = createLibvtermBackend(undefined, module)
    try {
      const read = cwd(backend)
      expect(read).toThrow("not initialized")
      backend.init({ cols: 80, rows: 24 })
      other.init({ cols: 80, rows: 24 })
      for (const empty of ["\x1b]7\x07", "\x1b]7;\x07", "\x1b]633;P;Cwd=\x1b\\"]) {
        backend.feed(encoder.encode("\x1b]7;/old\x07" + empty))
        expect(read()).toBeNull()
      }
      backend.feed(encoder.encode("\x1b]7;/before-ris\x07\x1b]7;partial\x1bc"))
      expect(read()).toBe("/before-ris")
      expect(cwd(other)()).toBeNull()
      backend.feed(encoder.encode("\x1b]633;P;Cwd=/new\x07\x1b]633;P;Cwd=partial"))
      expect(read()).toBe("/new")
      backend.reset()
      expect(read()).toBeNull()
      backend.feed(encoder.encode("\x1b]7;/after-reset\x07\x1b]7;partial"))
      backend.init({ cols: 80, rows: 24 })
      expect(read()).toBeNull()
      backend.feed(encoder.encode("\x1b]633;P;Cwd=/after-init\x07"))
      expect(read()).toBe("/after-init")
      backend.destroy()
      expect(read).toThrow("not initialized")
      backend.init({ cols: 80, rows: 24 })
      expect(read()).toBeNull()
    } finally {
      backend.destroy()
      other.destroy()
    }
  })

  test.each(["/raw/", "file:///longer-prefix/"])("rejects malformed callback UTF-8 after %s", (prefix) => {
    const backend = createLibvtermBackend(undefined, module)
    try {
      backend.init({ cols: 80, rows: 24 })
      const read = cwd(backend)
      backend.feed(encoder.encode(`\x1b]7;${prefix}`))
      backend.feed(Uint8Array.of(0xff, 0xc0, 0xaf, 0xe2, 0x28, 0xa1, 7))
      expect(read).toThrow(TypeError)
      backend.feed(encoder.encode("\x1b]7;/recovered\x07"))
      expect(read()).toBe("/recovered")
    } finally {
      backend.destroy()
    }
  })
})

// Receipt/window-query coverage never exercises the engine's selection callbacks.
test("OSC 52 clipboard writes roundtrip through per-instance selection callbacks", () => {
  const first = createLibvtermBackend(undefined, module)
  const second = createLibvtermBackend(undefined, module)
  let firstReply = ""
  let secondReply = ""
  first.onResponse = (bytes) => {
    firstReply += new TextDecoder().decode(bytes)
  }
  second.onResponse = (bytes) => {
    secondReply += new TextDecoder().decode(bytes)
  }
  try {
    first.init({ cols: 80, rows: 24 })
    second.init({ cols: 80, rows: 24 })
    const payload = Buffer.from("terminfo-osc52-31995").toString("base64")
    first.feed(encoder.encode(`\x1b]52;c;${payload}\x07${query}`))
    expect(firstReply).toBe(`\x1b]52;c;${payload}\x1b\\`)
    second.feed(encoder.encode(query))
    expect(secondReply).toBe("\x1b]52;c;\x1b\\")
    first.init({ cols: 80, rows: 24 })
    firstReply = ""
    first.feed(encoder.encode(query))
    expect(firstReply).toBe("\x1b]52;c;\x1b\\")
  } finally {
    first.destroy()
    second.destroy()
  }
})

// Accepted OSC 777 requirement: the existing OSC 9 tests never read completed
// 777 payloads, so cannot catch a missing native fallback/export/getter binding.
describe("OSC 777 notifications", () => {
  function payloads(backend: ReturnType<typeof createLibvtermBackend>): () => readonly string[] {
    if (!hasExtension<OscMetadataExtension>(backend, "osc-metadata") || !backend.getOsc777Payloads) {
      throw new Error("libvterm must expose engine-delivered OSC 777 payloads")
    }
    return () => backend.getOsc777Payloads!()
  }

  test("copies ordered completed payloads, including both empty forms and fragmented UTF-8", () => {
    const backend = createLibvtermBackend(undefined, module)
    try {
      backend.init({ cols: 80, rows: 24 })
      const read = payloads(backend)
      expect(read()).toEqual([])
      backend.feed(encoder.encode("\x1b]777\x07\x1b]777;\x07\x1b]9;separate\x07\x1b]777;notify;title;body\x1b\\"))
      expect(read()).toEqual(["", "", "notify;title;body"])
      const text = "notify;café;尾🦊".repeat(1024)
      const bytes = encoder.encode(`\x1b]777;${text}\x1b\\`)
      for (const byte of bytes.subarray(0, bytes.length - 1)) backend.feed(Uint8Array.of(byte))
      expect(read()).toEqual(["", "", "notify;title;body"])
      backend.feed(bytes.subarray(bytes.length - 1))
      backend.feed(encoder.encode("\x1b]777;duplicate\x07".repeat(12)))
      const expected = ["", "", "notify;title;body", text, ...Array(12).fill("duplicate")]
      expect(read()).toEqual(expected)
      const copy = read() as string[]
      copy.splice(0)
      expect(read()).toEqual(expected)
      expect(backend.getNotifications?.()).toEqual(["separate"])
    } finally {
      backend.destroy()
    }
  })

  test("uses one instance lifetime for both histories and clears partial payloads on reset and re-init", () => {
    // This native observer owns both subscriptions: reset clears complete and partial histories.
    const backend = createLibvtermBackend(undefined, module)
    const other = createLibvtermBackend(undefined, module)
    let reply = ""
    backend.onResponse = (bytes) => {
      reply += new TextDecoder().decode(bytes)
    }
    try {
      const read = payloads(backend)
      expect(read).toThrow("not initialized")
      backend.init({ cols: 80, rows: 24 })
      other.init({ cols: 80, rows: 24 })
      const clipboard = Buffer.from("selection café").toString("base64")
      backend.feed(
        encoder.encode(`\x1b]0;title\x07\x1b]52;c;${clipboard}\x07\x1b]9;nine\x07\x1b]777;old\x07\x1b]777;aborted`),
      )
      expect(read()).toEqual(["old"])
      expect(payloads(other)()).toEqual([])
      backend.feed(encoder.encode("\x18\x1b]777;complete\x07"))
      expect(read()).toEqual(["old", "complete"])
      expect(backend.getNotifications?.()).toEqual(["nine"])
      expect(backend.getTitle()).toBe("title")
      expect(reply).toBe("")
      backend.feed(encoder.encode(query + "\x1b[5n"))
      expect(reply).toBe(`\x1b]52;c;${clipboard}\x1b\\\x1b[0n`)
      backend.feed(encoder.encode("\x1b]9;partial-nine"))
      backend.reset()
      expect(read()).toEqual([])
      expect(backend.getNotifications?.()).toEqual([])
      backend.feed(encoder.encode("\x1b]777;after reset\x07\x1b]777;partial-reset"))
      backend.reset()
      backend.feed(encoder.encode("\x1b]777;fresh\x07\x1b]777;partial-init"))
      expect(read()).toEqual(["fresh"])
      backend.init({ cols: 80, rows: 24 })
      expect(read()).toEqual([])
      expect(backend.getNotifications?.()).toEqual([])
      backend.destroy()
      expect(read).toThrow("not initialized")
      backend.init({ cols: 80, rows: 24 })
      expect(read()).toEqual([])
    } finally {
      backend.destroy()
      other.destroy()
    }
  })
})

test("selection fragments retain the complete decoded payload until a query", () => {
  const backend = createLibvtermBackend(undefined, module)
  let reply = ""
  backend.onResponse = (bytes) => {
    reply += new TextDecoder().decode(bytes)
  }
  try {
    backend.init({ cols: 80, rows: 24 })
    const payload = Buffer.from("clipboard café 🦊").toString("base64")
    for (const part of ["\x1b]52;c;", payload.slice(0, 7), payload.slice(7), "\x1b\\", query]) {
      backend.feed(encoder.encode(part))
    }
    expect(reply).toBe(`\x1b]52;c;${payload}\x1b\\`)
  } finally {
    backend.destroy()
  }
})

// Existing selection/receipt tests do not send OSC 9. These cases exercise the
// real parser, C fragment callback, WASM exports and adapter readback together.
describe("OSC 9 notifications", () => {
  function notifications(backend: ReturnType<typeof createLibvtermBackend>): () => readonly string[] {
    if (!hasExtension<OscMetadataExtension>(backend, "osc-metadata") || !backend.getNotifications) {
      throw new Error("libvterm must expose engine-delivered OSC 9 notifications")
    }
    return () => backend.getNotifications!()
  }

  test("retains every completed payload in order across feed boundaries and returns a copy", () => {
    const backend = createLibvtermBackend(undefined, module)
    try {
      backend.init({ cols: 80, rows: 24 })
      const read = notifications(backend)
      expect(read()).toEqual([])
      backend.feed(encoder.encode("\x1b]9;first;payload\x07\x1b]9;4;1;50\x1b\\\x1b]9\x07\x1b]9;\x07"))
      const payload = "café;尾🦊".repeat(1024)
      const bytes = encoder.encode(`\x1b]9;${payload}\x1b\\`)
      for (const byte of bytes.subarray(0, bytes.length - 1)) backend.feed(Uint8Array.of(byte))
      expect(read()).toEqual(["first;payload", "4;1;50", "", ""])
      backend.feed(bytes.subarray(bytes.length - 1))
      expect(read()).toEqual(["first;payload", "4;1;50", "", "", payload])
      backend.feed(encoder.encode("\x1b]9;duplicate\x07".repeat(12)))
      const expected = ["first;payload", "4;1;50", "", "", payload, ...Array(12).fill("duplicate")]
      expect(read()).toEqual(expected)
      const copy = read() as string[]
      copy.splice(0)
      expect(read()).toEqual(expected)
    } finally {
      backend.destroy()
    }
  })

  test("discards interrupted staging before the next initial fragment", () => {
    const backend = createLibvtermBackend(undefined, module)
    try {
      backend.init({ cols: 80, rows: 24 })
      const read = notifications(backend)
      backend.feed(encoder.encode("\x1b]9;aborted fragment"))
      expect(read()).toEqual([])
      backend.feed(encoder.encode("\x18\x1b]9;complete\x07"))
      expect(read()).toEqual(["complete"])
    } finally {
      backend.destroy()
    }
  })

  test("coexists with title, selection and declined OSC commands without generating replies", () => {
    const backend = createLibvtermBackend(undefined, module)
    let reply = ""
    backend.onResponse = (bytes) => {
      reply += new TextDecoder().decode(bytes)
    }
    try {
      backend.init({ cols: 80, rows: 24 })
      const read = notifications(backend)
      const clipboard = Buffer.from("clipboard café").toString("base64")
      backend.feed(
        encoder.encode(
          `\x1b]0;icon and title\x07\x1b]9;notice\x07\x1b]52;c;${clipboard}\x07\x1b]777;declined\x07\x1b]2;final title\x07X`,
        ),
      )
      expect(backend.getTitle()).toBe("final title")
      expect(backend.getIconLabel?.()).toBe("icon and title")
      expect(backend.getCell(0, 0).char).toBe("X")
      expect(read()).toEqual(["notice"])
      expect(reply).toBe("")
      backend.feed(encoder.encode(query))
      expect(reply).toBe(`\x1b]52;c;${clipboard}\x1b\\`)
      expect(read()).toEqual(["notice"])
    } finally {
      backend.destroy()
    }
  })

  test("keeps instances separate and clears complete entries and staging on reset and re-init", () => {
    const backend = createLibvtermBackend(undefined, module)
    const other = createLibvtermBackend(undefined, module)
    try {
      const read = notifications(backend)
      expect(read).toThrow("not initialized")
      backend.init({ cols: 80, rows: 24 })
      other.init({ cols: 80, rows: 24 })
      backend.feed(encoder.encode("\x1b]9;old\x07\x1b]9;partial"))
      expect(read()).toEqual(["old"])
      expect(notifications(other)()).toEqual([])
      backend.reset()
      expect(read()).toEqual([])
      backend.feed(encoder.encode("\x1b]9;after reset\x07\x1b]9;partial re-init"))
      expect(read()).toEqual(["after reset"])
      backend.init({ cols: 80, rows: 24 })
      expect(read()).toEqual([])
      backend.feed(encoder.encode("\x1b]9;new\x07"))
      expect(read()).toEqual(["new"])
      backend.destroy()
      expect(read).toThrow("not initialized")
      backend.init({ cols: 80, rows: 24 })
      expect(read()).toEqual([])
    } finally {
      backend.destroy()
      other.destroy()
    }
  })
})
