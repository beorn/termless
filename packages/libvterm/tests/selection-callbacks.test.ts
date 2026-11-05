/**
 * @failure Engine-delivered OSC 9 notifications or OSC 52 selection callbacks disappear, join interrupted strings, or leak across instance lifecycles.
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
      expect(backend.getIconLabel()).toBe("icon and title")
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
