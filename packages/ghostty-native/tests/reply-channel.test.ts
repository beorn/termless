/**
 * @failure The native binding drops the query replies Ghostty's engine formats (DECRQM, DSR 5/6, kitty
 *   keyboard query), so every reply-path probe on ghostty-native reads silence instead of the engine's answer.
 * @level l0
 * @consumer Termless Ghostty native backend onResponse, read by terminfo.dev reply-path probes.
 * @testonly none
 */

import { describe, test, expect } from "vitest"
import { createGhosttyNativeBackend, loadGhosttyNative } from "../src/backend.ts"

let nativeBuildError: string | null = null
try {
  loadGhosttyNative()
} catch (error) {
  nativeBuildError = error instanceof Error ? error.message : String(error)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe.skipIf(nativeBuildError !== null)(
  `Ghostty native reply channel${nativeBuildError ? ` (unavailable: ${nativeBuildError})` : ""}`,
  () => {
    test("delivers each engine reply to onResponse in input order, once", () => {
      const backend = createGhosttyNativeBackend({ cols: 10, rows: 3 })
      const replies: string[] = []
      backend.onResponse = (data) => replies.push(decoder.decode(data))
      try {
        backend.feed(encoder.encode("\x1b[?2004h\x1b[?2004$p")) // DECRQM, private mode set
        backend.feed(encoder.encode("\x1b[?1004$p")) // DECRQM, private mode reset
        backend.feed(encoder.encode("\x1b[?5522$p")) // DECRQM, mode outside the engine's table
        backend.feed(encoder.encode("ab\x1b[6n")) // DSR 6, cursor position
        backend.feed(encoder.encode("\x1b[5n")) // DSR 5, operating status
        backend.feed(encoder.encode("\x1b[?u")) // kitty keyboard flags query
        backend.feed(encoder.encode("plain text\x1b[18t")) // no engine reply: nothing delivered
        expect(replies).toEqual([
          "\x1b[?2004;1$y",
          "\x1b[?1004;2$y",
          "\x1b[?5522;0$y",
          "\x1b[1;3R",
          "\x1b[0n",
          "\x1b[?0u",
        ])
      } finally {
        backend.destroy()
      }
    })

    test("keeps two replies from one feed in order", () => {
      const backend = createGhosttyNativeBackend({ cols: 10, rows: 3 })
      const replies: string[] = []
      backend.onResponse = (data) => replies.push(decoder.decode(data))
      try {
        backend.feed(encoder.encode("\x1b[5n\x1b[?2004$p"))
        expect(replies.join("")).toBe("\x1b[0n\x1b[?2004;2$y")
      } finally {
        backend.destroy()
      }
    })
  },
)
