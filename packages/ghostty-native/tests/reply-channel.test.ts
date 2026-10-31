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

    // The handler answers four query actions and hands every other action to ghostty's readonly handler. These
    // queries are answered by Ghostty's app (window, config, clipboard) or not at all, so a headless reply here
    // would be one this binding made up.
    test.each([
      ["DA1", "\x1b[c"],
      ["DA2", "\x1b[>c"],
      ["DA3", "\x1b[=c"],
      ["XTVERSION", "\x1b[>q"],
      ["ENQ", "\x05"],
      ["DSR 996 color scheme", "\x1b[?996n"],
      ["CSI 14 t", "\x1b[14t"],
      ["CSI 16 t", "\x1b[16t"],
      ["CSI 21 t", "\x1b[21t"],
      ["DECRQSS", "\x1bP$qm\x1b\\"],
      ["XTGETTCAP", "\x1bP+q544e\x1b\\"],
      ["OSC 4 palette query", "\x1b]4;1;?\x1b\\"],
      ["OSC 5 special color query", "\x1b]5;0;?\x1b\\"],
      ["OSC 10 foreground query", "\x1b]10;?\x1b\\"],
      ["OSC 11 background query", "\x1b]11;?\x1b\\"],
      ["OSC 12 cursor color query", "\x1b]12;?\x1b\\"],
      ["OSC 17 highlight background query", "\x1b]17;?\x1b\\"],
      ["OSC 19 highlight foreground query", "\x1b]19;?\x1b\\"],
      ["OSC 21 kitty color query", "\x1b]21;foreground=?\x1b\\"],
      ["OSC 52 clipboard read", "\x1b]52;c;?\x1b\\"],
      ["kitty graphics query", "\x1b_Gi=1,a=q;\x1b\\"],
    ])("delivers nothing for %s, which the engine does not answer", (_name, query) => {
      const backend = createGhosttyNativeBackend({ cols: 10, rows: 3 })
      const replies: string[] = []
      backend.onResponse = (data) => replies.push(decoder.decode(data))
      try {
        backend.feed(encoder.encode(query))
        expect(replies).toEqual([])
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
