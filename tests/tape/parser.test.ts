/**
 * Tests for the VHS .tape format parser.
 *
 * Covers all command types, duration parsing, edge cases, and settings collection.
 */

import { describe, test, expect } from "vitest"
import { parseTape, parseDuration } from "../../src/tape/parser.ts"
import type { TapeCommand } from "../../src/tape/parser.ts"

// =============================================================================
// Duration parsing
// =============================================================================

describe("parseDuration", () => {
  test("parses seconds", () => {
    expect(parseDuration("2s")).toBe(2000)
  })

  test("parses fractional seconds", () => {
    expect(parseDuration("0.5s")).toBe(500)
  })

  test("parses milliseconds", () => {
    expect(parseDuration("500ms")).toBe(500)
  })

  test("parses bare number as milliseconds", () => {
    expect(parseDuration("100")).toBe(100)
  })

  test("handles whitespace", () => {
    expect(parseDuration("  2s  ")).toBe(2000)
  })

  test("parses large durations", () => {
    expect(parseDuration("30s")).toBe(30000)
  })
})

// =============================================================================
// Comment and blank line handling
// =============================================================================

describe("comments and blank lines", () => {
  test("skips comments", () => {
    const tape = parseTape("# This is a comment\n# Another comment")
    expect(tape.commands).toHaveLength(0)
  })

  test("skips blank lines", () => {
    const tape = parseTape("\n\n\n")
    expect(tape.commands).toHaveLength(0)
  })

  test("skips mixed comments and blanks", () => {
    const tape = parseTape("# comment\n\n# another\n")
    expect(tape.commands).toHaveLength(0)
  })
})

// =============================================================================
// Output command
// =============================================================================

describe("Output command", () => {
  test("parses output path", () => {
    const tape = parseTape("Output demo.gif")
    expect(tape.commands).toEqual([{ type: "output", path: "demo.gif" }])
  })

  test("parses output path with spaces", () => {
    const tape = parseTape("Output path/to/my file.gif")
    expect(tape.commands).toEqual([{ type: "output", path: "path/to/my file.gif" }])
  })
})

// =============================================================================
// Set command
// =============================================================================

describe("Set command", () => {
  test("parses set with simple value", () => {
    const tape = parseTape("Set FontSize 14")
    expect(tape.commands).toEqual([{ type: "set", key: "FontSize", value: "14" }])
  })

  test("parses set with quoted value", () => {
    const tape = parseTape('Set Shell "bash"')
    expect(tape.commands).toEqual([{ type: "set", key: "Shell", value: "bash" }])
  })

  test("parses set with quoted value containing spaces", () => {
    const tape = parseTape('Set Theme "My Theme"')
    expect(tape.commands).toEqual([{ type: "set", key: "Theme", value: "My Theme" }])
  })

  test("collects settings into settings map", () => {
    const tape = parseTape("Set FontSize 14\nSet Width 1200\nSet Height 600")
    expect(tape.settings).toEqual({
      FontSize: "14",
      Width: "1200",
      Height: "600",
    })
  })

  test("parses duration setting", () => {
    const tape = parseTape("Set TypingSpeed 50ms")
    expect(tape.settings.TypingSpeed).toBe("50ms")
  })
})

// =============================================================================
// Type command
// =============================================================================

describe("Type command", () => {
  test("parses type with quoted text", () => {
    const tape = parseTape('Type "hello world"')
    expect(tape.commands).toEqual([{ type: "type", text: "hello world" }])
  })

  test("parses type with speed modifier", () => {
    const tape = parseTape('Type@100ms "slow typing"')
    expect(tape.commands).toEqual([{ type: "type", text: "slow typing", speed: 100 }])
  })

  test("parses type with second-based speed", () => {
    const tape = parseTape('Type@0.5s "half second"')
    expect(tape.commands).toEqual([{ type: "type", text: "half second", speed: 500 }])
  })

  test("parses type with unquoted text", () => {
    const tape = parseTape("Type hello")
    expect(tape.commands).toEqual([{ type: "type", text: "hello" }])
  })
})

// =============================================================================
// Key commands
// =============================================================================

describe("key commands", () => {
  test("parses Enter", () => {
    const tape = parseTape("Enter")
    expect(tape.commands).toEqual([{ type: "key", key: "Enter" }])
  })

  test("parses Backspace with count", () => {
    const tape = parseTape("Backspace 3")
    expect(tape.commands).toEqual([{ type: "key", key: "Backspace", count: 3 }])
  })

  test("parses Delete with count", () => {
    const tape = parseTape("Delete 2")
    expect(tape.commands).toEqual([{ type: "key", key: "Delete", count: 2 }])
  })

  test("parses Tab", () => {
    const tape = parseTape("Tab")
    expect(tape.commands).toEqual([{ type: "key", key: "Tab" }])
  })

  test("parses Space", () => {
    const tape = parseTape("Space")
    expect(tape.commands).toEqual([{ type: "key", key: "Space" }])
  })

  test("parses arrow keys", () => {
    const tape = parseTape("Up\nDown\nLeft\nRight")
    expect(tape.commands).toEqual([
      { type: "key", key: "Up" },
      { type: "key", key: "Down" },
      { type: "key", key: "Left" },
      { type: "key", key: "Right" },
    ])
  })

  test("parses Escape", () => {
    const tape = parseTape("Escape")
    expect(tape.commands).toEqual([{ type: "key", key: "Escape" }])
  })

  test("parses PageUp and PageDown", () => {
    const tape = parseTape("PageUp\nPageDown")
    expect(tape.commands).toEqual([
      { type: "key", key: "PageUp" },
      { type: "key", key: "PageDown" },
    ])
  })

  test("parses Home and End", () => {
    const tape = parseTape("Home\nEnd")
    expect(tape.commands).toEqual([
      { type: "key", key: "Home" },
      { type: "key", key: "End" },
    ])
  })
})

// =============================================================================
// Modifier key commands
// =============================================================================

describe("modifier keys", () => {
  test("parses Ctrl+C", () => {
    const tape = parseTape("Ctrl+C")
    expect(tape.commands).toEqual([{ type: "ctrl", key: "C" }])
  })

  test("parses Ctrl+lowercase", () => {
    const tape = parseTape("Ctrl+c")
    expect(tape.commands).toEqual([{ type: "ctrl", key: "c" }])
  })

  test("parses Alt+F", () => {
    const tape = parseTape("Alt+F")
    expect(tape.commands).toEqual([{ type: "alt", key: "F" }])
  })
})

// =============================================================================
// Sleep command
// =============================================================================

describe("Sleep command", () => {
  test("parses sleep with seconds", () => {
    const tape = parseTape("Sleep 2s")
    expect(tape.commands).toEqual([{ type: "sleep", ms: 2000 }])
  })

  test("parses sleep with milliseconds", () => {
    const tape = parseTape("Sleep 500ms")
    expect(tape.commands).toEqual([{ type: "sleep", ms: 500 }])
  })
})

// =============================================================================
// Screenshot command
// =============================================================================

describe("Screenshot command", () => {
  test("parses screenshot without path", () => {
    const tape = parseTape("Screenshot")
    expect(tape.commands).toEqual([{ type: "screenshot" }])
  })

  test("parses screenshot with path", () => {
    const tape = parseTape("Screenshot path/to/file.png")
    expect(tape.commands).toEqual([{ type: "screenshot", path: "path/to/file.png" }])
  })
})

// =============================================================================
// Hide/Show commands
// =============================================================================

describe("Hide/Show commands", () => {
  test("parses Hide", () => {
    const tape = parseTape("Hide")
    expect(tape.commands).toEqual([{ type: "hide" }])
  })

  test("parses Show", () => {
    const tape = parseTape("Show")
    expect(tape.commands).toEqual([{ type: "show" }])
  })
})

// =============================================================================
// Source command
// =============================================================================

describe("Source command", () => {
  test("parses source with path", () => {
    const tape = parseTape("Source other.tape")
    expect(tape.commands).toEqual([{ type: "source", path: "other.tape" }])
  })
})

// =============================================================================
// Require command
// =============================================================================

describe("Require command", () => {
  test("parses require with program name", () => {
    const tape = parseTape("Require bash")
    expect(tape.commands).toEqual([{ type: "require", program: "bash" }])
  })
})

// =============================================================================
// Full tape parsing
// =============================================================================

describe("full tape parsing", () => {
  test("parses a complete tape file", () => {
    const source = `
# Demo tape
Output demo.gif
Set FontSize 14
Set Width 1200
Set Height 600
Set Shell "bash"
Set TypingSpeed 50ms

Type "hello world"
Enter
Backspace 3
Sleep 2s
Screenshot
`

    const tape = parseTape(source)

    expect(tape.settings).toEqual({
      FontSize: "14",
      Width: "1200",
      Height: "600",
      Shell: "bash",
      TypingSpeed: "50ms",
    })

    expect(tape.commands).toHaveLength(11) // Output + 5 Set + Type + Enter + Backspace + Sleep + Screenshot
    const types = tape.commands.map((c) => c.type)
    expect(types).toEqual(["output", "set", "set", "set", "set", "set", "type", "key", "key", "sleep", "screenshot"])
  })

  test("preserves command order", () => {
    const tape = parseTape('Enter\nType "hello"\nEnter\nSleep 1s')
    expect(tape.commands.map((c) => c.type)).toEqual(["key", "type", "key", "sleep"])
  })
})
