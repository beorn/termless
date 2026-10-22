/**
 * Colour replies come only from engine state — alacritty backend.
 *
 * alacritty_terminal answers OSC 4/10/11/12 queries by sending
 * Event::ColorRequest(index, formatter); the bridge answers it with the
 * engine's own colour (Term::colors()) through the engine's own formatter.
 * An unset colour has no engine value, so it gets no reply: an adapter
 * default palette would make the reset case below answer and turn it red.
 *
 * @failure  a colour query answers with an adapter-invented colour after a reset, or a colour reply arrives out of stream order with DA1/DSR replies
 * @level    l2 — real native alacritty_terminal through the backend's feed/onResponse, no PTY
 * @consumer terminfo #30711 extensions.osc104/osc110/osc111/osc112 set-reset-query probes
 * @testonly none
 *
 * Skipped when the native .node binary isn't built locally.
 */

import { describe, test, expect } from "vitest"
import { createAlacrittyBackend, loadAlacrittyNative } from "../src/backend.ts"

// Skip all tests if native module is not available
let nativeAvailable = false
let skipReason = ""
try {
  loadAlacrittyNative()
  nativeAvailable = true
} catch (e) {
  skipReason = e instanceof Error ? e.message.split("\n")[0]! : String(e)
}

const describeNative = nativeAvailable ? describe : describe.skip

/** A fresh backend whose feed() returns exactly the reply chunks that feed delivered to onResponse. */
function createReplyBackend(): { feed(seq: string): string[]; destroy(): void } {
  const backend = createAlacrittyBackend()
  backend.init({ cols: 80, rows: 24 })
  const replies: string[] = []
  backend.onResponse = (bytes: Uint8Array): void => {
    replies.push(new TextDecoder().decode(bytes))
  }
  return {
    feed(seq: string): string[] {
      replies.length = 0
      backend.feed(new TextEncoder().encode(seq))
      return [...replies]
    },
    destroy: () => backend.destroy(),
  }
}

describeNative(
  `colour replies come only from engine state — alacritty backend${skipReason ? ` (skipped: ${skipReason})` : ""}`,
  () => {
    test("an unset palette colour gets no reply and a set one gets the engine's reply", () => {
      const t = createReplyBackend()
      expect(t.feed("\x1b]4;1;?\x07")).toEqual([])
      t.feed("\x1b]4;1;rgb:12/34/56\x07")
      expect(t.feed("\x1b]4;1;?\x07")).toEqual(["\x1b]4;1;rgb:1212/3434/5656\x07"])
      t.destroy()
    })

    test("a reset palette colour gets no reply, never an adapter default", () => {
      const t = createReplyBackend()
      t.feed("\x1b]4;1;rgb:12/34/56\x07")
      t.feed("\x1b]104;1\x07")
      expect(t.feed("\x1b]4;1;?\x07")).toEqual([])
      t.destroy()
    })

    test("DA1, a colour query and DSR 6 in one feed answer in stream order in one drain", () => {
      const t = createReplyBackend()
      t.feed("\x1b]10;rgb:aa/bb/cc\x07")
      expect(t.feed("\x1b[c\x1b]10;?\x07\x1b[6n")).toEqual(["\x1b[?6c\x1b]10;rgb:aaaa/bbbb/cccc\x07\x1b[1;1R"])
      t.destroy()
    })
  },
)
