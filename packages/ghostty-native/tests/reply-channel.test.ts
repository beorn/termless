/**
 * @failure The native binding drops the query replies Ghostty's engine formats (DECRQM, DSR 5/6, kitty
 *   keyboard query, OSC 4/10/11/12 and OSC 21 colour queries), so every reply-path probe on ghostty-native
 *   reads silence instead of the engine's answer.
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

    // The handler answers the mode, status, kitty keyboard and colour query actions and hands every other action
    // to ghostty's readonly handler. These queries are answered by Ghostty's app (window, config, clipboard) or not
    // at all, so a headless reply here would be one this binding made up. OSC 5, 17 and 19 stay silent because
    // termio does not report special or highlight colours.
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
      ["OSC 5 special color query", "\x1b]5;0;?\x1b\\"],
      ["OSC 17 highlight background query", "\x1b]17;?\x1b\\"],
      ["OSC 19 highlight foreground query", "\x1b]19;?\x1b\\"],
      ["OSC 52 clipboard read", "\x1b]52;c;?\x1b\\"],
      ["kitty graphics query", "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\"],
    ])("delivers nothing for %s, which the engine does not answer", (_name, query) => {
      const backend = createGhosttyNativeBackend({ cols: 10, rows: 3 })
      const replies: string[] = []
      backend.onResponse = (data) => replies.push(decoder.decode(data))
      try {
        if (_name === "kitty graphics query") {
          // A live reply path rules out dead transport; the imported ghostty-vt build disables graphics.
          backend.feed(encoder.encode("\x1b[5n"))
          expect(replies).toEqual(["\x1b[0n"])
          replies.length = 0
        }
        backend.feed(encoder.encode(query))
        expect(replies).toEqual([])
        if (_name === "kitty graphics query") expect(backend.capabilities.kittyGraphics).toBe(false)
      } finally {
        backend.destroy()
      }
    })

    // Colour queries are answered from the colours the engine holds, formatted as Ghostty's termio does at
    // 332b2aef (colorOperation 16-bit default, kittyColorReport), per @cto 8e17813a and 1c6ca570.
    const run = (...feeds: string[]): string[] => {
      const backend = createGhosttyNativeBackend({ cols: 10, rows: 3 })
      const replies: string[] = []
      backend.onResponse = (data) => replies.push(decoder.decode(data))
      try {
        for (const feed of feeds) backend.feed(encoder.encode(feed))
        return replies
      } finally {
        backend.destroy()
      }
    }

    test("answers OSC 4, 10, 11 and 12 queries with the colour the engine holds after a set", () => {
      expect(
        run(
          "\x1b]4;1;rgb:ab/cd/ef\x1b\\",
          "\x1b]4;1;?\x1b\\",
          "\x1b]10;rgb:12/34/56\x1b\\",
          "\x1b]10;?\x1b\\",
          "\x1b]11;rgb:01/02/03\x1b\\",
          "\x1b]11;?\x07",
          "\x1b]12;rgb:fe/dc/ba\x1b\\",
          "\x1b]12;?\x1b\\",
        ),
      ).toEqual([
        "\x1b]4;1;rgb:abab/cdcd/efef\x1b\\",
        "\x1b]10;rgb:1212/3434/5656\x1b\\",
        "\x1b]11;rgb:0101/0202/0303\x07",
        "\x1b]12;rgb:fefe/dcdc/baba\x1b\\",
      ])
    })

    test("answers OSC 21 queries with the colour the engine holds, in request order", () => {
      expect(
        run(
          "\x1b]21;foreground=rgb:12/34/56;1=rgb:ab/cd/ef\x1b\\",
          "\x1b]21;foreground=?;1=?;background=?\x1b\\",
          "\x1b]21;cursor=?;cursor=rgb:0a/0b/0c;cursor=?\x07",
        ),
      ).toEqual([
        // background was never set: termio writes the key with an empty value.
        "\x1b]21;foreground=rgb:12/34/56;1=rgb:ab/cd/ef;background=\x1b\\",
        "\x1b]21;cursor=;cursor=rgb:0a/0b/0c\x07",
      ])
    })

    test("answers a query after a set in the same OSC 4 request with the colour that set left", () => {
      expect(run("\x1b]4;2;rgb:10/20/30\x1b\\", "\x1b]4;2;?;2;rgb:01/02/03;2;?\x1b\\")).toEqual([
        "\x1b]4;2;rgb:1010/2020/3030\x1b\\\x1b]4;2;rgb:0101/0202/0303\x1b\\",
      ])
    })

    test("delivers nothing for colour sets and resets with no query", () => {
      expect(
        run(
          "\x1b]4;1;rgb:ab/cd/ef\x1b\\",
          "\x1b]10;rgb:12/34/56\x1b\\",
          "\x1b]11;rgb:01/02/03\x1b\\",
          "\x1b]12;rgb:fe/dc/ba\x1b\\",
          "\x1b]21;foreground=rgb:12/34/56;background=\x1b\\",
          "\x1b]104;1\x1b\\",
          "\x1b]110\x1b\\",
        ),
      ).toEqual([])
    })

    // termio panics on a query for an unset foreground or background; this adapter skips only that request
    // and never invents a value (@cto 1c6ca570). The cursor falls back to the foreground, as termio does.
    test("skips only the query for an unset dynamic colour", () => {
      expect(run("\x1b]10;?\x1b\\", "\x1b]11;?\x1b\\", "\x1b]12;?\x1b\\")).toEqual([])
      expect(run("\x1b]10;rgb:12/34/56\x1b\\", "\x1b]12;?\x1b\\")).toEqual(["\x1b]12;rgb:1212/3434/5656\x1b\\"])
      expect(run("\x1b]4;3;rgb:01/02/03\x1b\\", "\x1b]4;3;?;4;?\x1b\\")[0]).toMatch(
        /^\x1b\]4;3;rgb:0101\/0202\/0303\x1b\\\x1b\]4;4;rgb:[0-9a-f]{4}\/[0-9a-f]{4}\/[0-9a-f]{4}\x1b\\$/,
      )
    })

    test("writes only the OSC 21 prefix and terminator for a key termio does not report", () => {
      expect(run("\x1b]21;selection_foreground=?\x1b\\")).toEqual(["\x1b]21\x1b\\"])
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
