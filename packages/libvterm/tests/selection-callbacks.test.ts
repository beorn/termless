/**
 * @failure OSC 52 writes and queries disappear because the WASM embedder has no selection callbacks, or instances share selection state.
 * @level l1
 * @consumer Terminfo OSC 52 clipboard/write criteria through real libvterm WASM and TerminalBackend.feed/onResponse.
 * @testonly none
 */
import { expect, test } from "vitest"
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
