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
  test("stays silent on DSR ?996 when the engine has no color-scheme state", () => {
    const responses = responsesFor("\x1b[?996n")

    expect(responses).toEqual([])
  })
})
