import { describe, expect, test } from "vitest"
import { createVtermBackend } from "../src/backend.ts"

const enc = new TextEncoder()
const dec = new TextDecoder()

function responsesFor(query: string): string[] {
  const backend = createVtermBackend()
  backend.init({ cols: 80, rows: 24 })
  const responses: string[] = []
  backend.onResponse = (chunk) => {
    responses.push(dec.decode(chunk))
  }
  backend.feed(enc.encode(query))
  backend.destroy()
  return responses
}

describe("@termless/vterm color scheme probes", () => {
  test.each([
    ["default dark background", "", "\x1b[?997;1n"],
    ["declared light background", "\x1b]11;rgb:ffff/ffff/ffff\x1b\\", "\x1b[?997;2n"],
  ])("forwards the released engine's color scheme for %s", (_name, setup, reply) => {
    expect(responsesFor(setup + "\x1b[?996n")).toEqual([reply])
  })
})
