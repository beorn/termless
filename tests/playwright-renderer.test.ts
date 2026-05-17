import { describe, expect, test } from "vitest"
import { createTerminal } from "../src/terminal.ts"
import { screenshotPlaywrightPng as exportedScreenshotPlaywrightPng } from "../src/index.ts"
import { screenshotPlaywrightPng } from "../src/playwright.ts"
import { createXtermBackend } from "../packages/xtermjs/src/index.ts"
import type {
  Cell,
  CursorState,
  PlaywrightModuleLike,
  ScrollbackState,
  TerminalMode,
  TerminalReadable,
  UnderlineStyle,
} from "../src/types.ts"

function defaultCell(char = " "): Cell {
  return {
    char,
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false as UnderlineStyle,
    underlineColor: null,
    strikethrough: false,
    inverse: false,
    blink: false,
    hidden: false,
    wide: false,
    continuation: false,
    hyperlink: null,
  }
}

function createMockReadable(lines: string[]): TerminalReadable {
  const cellLines: Cell[][] = lines.map((line) => [...line].map((char) => defaultCell(char)))
  const cursor: CursorState = { x: 0, y: 0, visible: false, style: "block" }

  return {
    getText: () => lines.join("\n"),
    getTextRange: (sr, sc, er, ec) => {
      const result: string[] = []
      for (let r = sr; r <= er && r < lines.length; r++) {
        const start = r === sr ? sc : 0
        const end = r === er ? ec : lines[r]!.length
        result.push(lines[r]!.slice(start, end))
      }
      return result.join("\n")
    },
    getCell: (row, col): Cell => cellLines[row]?.[col] ?? defaultCell(),
    getLine: (row): Cell[] => cellLines[row] ?? [],
    getLines: () => cellLines,
    getCursor: () => cursor,
    getMode: (_mode: TerminalMode) => false,
    getTitle: () => "",
    getScrollback: (): ScrollbackState => ({
      viewportOffset: 0,
      totalLines: lines.length,
      screenLines: lines.length,
    }),
  }
}

describe("screenshotPlaywrightPng", () => {
  test("renders the terminal SVG through Playwright and returns PNG bytes", async () => {
    const calls: {
      launchOptions?: unknown
      pageOptions?: unknown
      screenshotOptions?: unknown
      html?: string
      closed: boolean
    } = { closed: false }

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const playwright: PlaywrightModuleLike = {
      chromium: {
        launch: async (options) => {
          calls.launchOptions = options
          return {
            newPage: async (options) => {
              calls.pageOptions = options
              return {
                setContent: async (html) => {
                  calls.html = html
                },
                screenshot: async (options) => {
                  calls.screenshotOptions = options
                  return pngBytes
                },
              }
            },
            close: async () => {
              calls.closed = true
            },
          }
        },
      },
    }

    const terminal = createMockReadable(["playwright"])
    const png = await screenshotPlaywrightPng(terminal, {
      playwright,
      scale: 3,
      launchOptions: { channel: "chrome" },
    })

    expect(png).toEqual(pngBytes)
    expect(calls.launchOptions).toEqual({ channel: "chrome" })
    expect(calls.pageOptions).toEqual({
      viewport: { width: 96, height: 20 },
      deviceScaleFactor: 3,
    })
    expect(calls.html).toContain("<svg")
    expect(calls.html).toContain("playwright")
    expect(calls.screenshotOptions).toEqual({ type: "png" })
    expect(calls.closed).toBe(true)
  })

  test("is exported from the public entrypoint", () => {
    expect(exportedScreenshotPlaywrightPng).toBe(screenshotPlaywrightPng)
  })

  test("Terminal exposes the Playwright PNG renderer", async () => {
    const terminal = createTerminal({ backend: createXtermBackend(), cols: 2, rows: 1 })
    const playwright: PlaywrightModuleLike = {
      chromium: {
        launch: async () => ({
          newPage: async () => ({
            setContent: async () => {},
            screenshot: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          }),
          close: async () => {},
        }),
      },
    }

    try {
      terminal.feed("ok")
      await expect(terminal.screenshotPlaywrightPng({ playwright })).resolves.toEqual(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      )
    } finally {
      await terminal.close()
    }
  })

  test("adds a browser install hint when Chromium cannot launch", async () => {
    const playwright: PlaywrightModuleLike = {
      chromium: {
        launch: async () => {
          throw new Error("missing browser")
        },
      },
    }

    await expect(screenshotPlaywrightPng(createMockReadable(["hi"]), { playwright })).rejects.toThrow(
      "bunx playwright install chromium",
    )
  })
})
