/**
 * Tests for OSC 52 clipboard capture in the Terminal layer.
 *
 * OSC 52 format: \x1b]52;c;<base64>\x07 (BEL) or \x1b]52;c;<base64>\x1b\\ (ST)
 * The terminal intercepts these sequences, decodes the base64, and stores
 * the decoded text in `clipboardWrites`.
 */

import { describe, test, expect } from "vitest"
import { createTerminal } from "../src/terminal/terminal.ts"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import "../packages/viterm/src/matchers.ts"

type ClipboardMatcherExpect = {
  toHaveClipboardText(text: string): void
}

function createTerm(cols = 80, rows = 24) {
  return createTerminal({ backend: createXtermBackend(), cols, rows })
}

describe("OSC 52 clipboard capture", () => {
  test("captures OSC 52 clipboard write with BEL terminator", () => {
    const term = createTerm()
    const encoded = btoa("hello clipboard")
    term.feed(`\x1b]52;c;${encoded}\x07`)

    expect(term.clipboardWrites).toEqual(["hello clipboard"])
    term.close()
  })

  test("captures OSC 52 clipboard write with ST terminator", () => {
    const term = createTerm()
    const encoded = btoa("ST terminated")
    term.feed(`\x1b]52;c;${encoded}\x1b\\`)

    expect(term.clipboardWrites).toEqual(["ST terminated"])
    term.close()
  })

  test("decodes base64 content correctly", () => {
    const term = createTerm()
    const text = 'Hello, World! special chars: <>&"'
    const encoded = btoa(text)
    term.feed(`\x1b]52;c;${encoded}\x07`)

    expect(term.clipboardWrites[0]).toBe(text)
    term.close()
  })

  test("captures multiple clipboard writes in order", () => {
    const term = createTerm()
    term.feed(`\x1b]52;c;${btoa("first")}\x07`)
    term.feed(`\x1b]52;c;${btoa("second")}\x07`)
    term.feed(`\x1b]52;c;${btoa("third")}\x1b\\`)

    expect(term.clipboardWrites).toEqual(["first", "second", "third"])
    term.close()
  })

  test("captures multiple OSC 52 sequences in a single feed", () => {
    const term = createTerm()
    term.feed(`\x1b]52;c;${btoa("one")}\x07\x1b]52;c;${btoa("two")}\x07`)

    expect(term.clipboardWrites).toEqual(["one", "two"])
    term.close()
  })

  test("passes OSC 52 data through to backend", () => {
    const term = createTerm()
    // Feed some visible text alongside an OSC 52 sequence
    term.feed(`Hello\x1b]52;c;${btoa("clip")}\x07World`)

    // Clipboard should be captured
    expect(term.clipboardWrites).toEqual(["clip"])

    // Backend should still have received the surrounding text
    expect(term.screen.getText()).toContain("Hello")
    expect(term.screen.getText()).toContain("World")

    term.close()
  })

  test("clipboardWrites starts empty", () => {
    const term = createTerm()
    expect(term.clipboardWrites).toEqual([])
    term.close()
  })

  test("handles OSC 52 with empty selection parameter", () => {
    const term = createTerm()
    // Some implementations use empty selection param instead of 'c'
    const encoded = btoa("no selection param")
    term.feed(`\x1b]52;;${encoded}\x07`)

    expect(term.clipboardWrites).toEqual(["no selection param"])
    term.close()
  })

  test("toHaveClipboardText matcher succeeds for captured text", () => {
    const term = createTerm()
    term.feed(`\x1b]52;c;${btoa("matched")}\x07`)

    ;(expect(term) as unknown as ClipboardMatcherExpect).toHaveClipboardText("matched")
    term.close()
  })

  test("toHaveClipboardText matcher fails with helpful message for no writes", () => {
    const term = createTerm()

    expect(() => {
      ;(expect(term) as unknown as ClipboardMatcherExpect).toHaveClipboardText("missing")
    }).toThrow("no OSC 52 writes were captured")

    term.close()
  })

  test("toHaveClipboardText matcher fails with helpful message showing captured writes", () => {
    const term = createTerm()
    term.feed(`\x1b]52;c;${btoa("actual text")}\x07`)

    expect(() => {
      ;(expect(term) as unknown as ClipboardMatcherExpect).toHaveClipboardText("wrong text")
    }).toThrow("actual text")

    term.close()
  })
})

describe("raw output capture", () => {
  test("captures protocol output separately from rendered screen text", () => {
    const term = createTerm()
    const kittyPacket = "\x1b_Ga=p,i=7;payload\x1b\\"

    term.feed(`before${kittyPacket}after`)

    expect(term.out.getText()).toContain(kittyPacket)
    expect(term.screen.getText()).toContain("before")
    expect(term.screen.getText()).toContain("after")
    expect(term.screen.getText()).not.toContain("a=p,i=7")
    term.close()
  })

  test("toContainOutput lazily waits for later protocol output", async () => {
    const term = createTerm()
    const kittyPacket = "\x1b_Ga=p,i=9;payload\x1b\\"

    setTimeout(() => term.feed(kittyPacket), 10)

    await expect(term.out).toContainOutput(kittyPacket, { timeout: 500 })
    term.close()
  })

  test("raw output capture can be cleared between protocol assertions", () => {
    const term = createTerm()

    term.feed("\x1b_Ga=p,i=1;payload\x1b\\")
    expect(term.out.getText()).toContain("a=p")

    term.out.clear()
    expect(term.out.getText()).toBe("")

    term.feed("\x1b_Ga=d,d=i,i=1\x1b\\")
    expect(term.out.getText()).toContain("a=d,d=i")
    term.close()
  })
})
