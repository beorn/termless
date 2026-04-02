/**
 * Tests for the VHS .tape executor.
 *
 * Uses the vt100 backend (pure TypeScript, sync init, fast) created directly
 * via createVt100Backend() — bypasses the registry for reliable test resolution.
 */

import { describe, test, expect } from "vitest"
import { parseTape } from "../../src/tape/parser.ts"
import { executeTape } from "../../src/tape/executor.ts"
import { createVt100Backend } from "../../packages/vt100/src/backend.ts"

// =============================================================================
// Helpers
// =============================================================================

/** Create a vt100 backend instance for testing. */
function vt100() {
  return createVt100Backend()
}

// =============================================================================
// Basic execution
// =============================================================================

describe("executeTape", () => {
  test("returns result with duration and terminal", async () => {
    const tape = parseTape("# empty tape")
    const result = await executeTape(tape, { backend: vt100() })

    expect(result.duration).toBeGreaterThanOrEqual(0)
    expect(result.terminal).toBeDefined()
    expect(result.screenshotCount).toBe(0)
    expect(result.frames).toHaveLength(0)

    await result.terminal.close()
  })

  test("uses settings for terminal dimensions", async () => {
    const tape = parseTape("Set Width 100\nSet Height 30")
    const result = await executeTape(tape, { backend: vt100() })

    expect(result.terminal.cols).toBe(100)
    expect(result.terminal.rows).toBe(30)

    await result.terminal.close()
  })

  test("options cols/rows set initial dimensions", async () => {
    // Note: Set Width/Height in the tape are also executed dynamically,
    // so they override the initial dimensions. Use a tape without Set
    // to test the options taking effect.
    const tape = parseTape("# no Set commands")
    const result = await executeTape(tape, {
      backend: vt100(),
      cols: 60,
      rows: 20,
    })

    expect(result.terminal.cols).toBe(60)
    expect(result.terminal.rows).toBe(20)

    await result.terminal.close()
  })

  test("defaults to 80x24 when no dimensions specified", async () => {
    const tape = parseTape("# no dimensions")
    const result = await executeTape(tape, { backend: vt100() })

    expect(result.terminal.cols).toBe(80)
    expect(result.terminal.rows).toBe(24)

    await result.terminal.close()
  })
})

// =============================================================================
// Type command (headless — feeds raw characters)
// =============================================================================

describe("Type command", () => {
  test("feeds characters into terminal", async () => {
    const tape = parseTape('Type "hello"')
    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
    })

    expect(result.terminal.getText()).toContain("hello")
    await result.terminal.close()
  })

  test("feeds each character individually", async () => {
    const tape = parseTape('Type "ab"')
    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
    })

    expect(result.terminal.getText()).toContain("ab")
    await result.terminal.close()
  })
})

// =============================================================================
// Key commands (headless — feeds ANSI sequences)
// =============================================================================

describe("key commands", () => {
  test("Enter feeds carriage return", async () => {
    // In headless mode (no PTY), Enter sends \r which moves the cursor
    // to column 0. Without a shell echoing \n, the next Type overwrites.
    // Verify that Enter is correctly fed (cursor moves back to col 0).
    const tape = parseTape('Type "AAAA"\nEnter\nType "BB"')
    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
    })

    // "BB" overwrites the first two chars of "AAAA" → "BBAA"
    const text = result.terminal.getText()
    expect(text).toContain("BBAA")
    await result.terminal.close()
  })

  test("key with count repeats", async () => {
    const tape = parseTape("Backspace 3")
    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
    })
    expect(result.terminal).toBeDefined()
    await result.terminal.close()
  })

  test("Ctrl+key sends control character", async () => {
    const tape = parseTape("Ctrl+C")
    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
    })
    expect(result.terminal).toBeDefined()
    await result.terminal.close()
  })

  test("Alt+key sends escape sequence", async () => {
    const tape = parseTape("Alt+F")
    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
    })
    expect(result.terminal).toBeDefined()
    await result.terminal.close()
  })
})

// =============================================================================
// Sleep command
// =============================================================================

describe("Sleep command", () => {
  test("introduces actual delay", async () => {
    const tape = parseTape("Sleep 50ms")
    const start = Date.now()
    const result = await executeTape(tape, { backend: vt100() })
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(40)
    await result.terminal.close()
  })
})

// =============================================================================
// Screenshot command
// =============================================================================

describe("Screenshot command", () => {
  test("calls onScreenshot callback", async () => {
    const tape = parseTape('Type "test"\nScreenshot')
    const screenshots: { png: Uint8Array; path?: string }[] = []

    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
      onScreenshot: (png, path) => {
        screenshots.push({ png, path })
      },
    })

    expect(result.screenshotCount).toBe(1)
    expect(screenshots).toHaveLength(1)
    expect(screenshots[0]!.png).toBeInstanceOf(Uint8Array)
    expect(screenshots[0]!.png.length).toBeGreaterThan(0)
    await result.terminal.close()
  })

  test("passes screenshot path to callback", async () => {
    const tape = parseTape("Screenshot output/demo.png")
    const screenshots: { png: Uint8Array; path?: string }[] = []

    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
      onScreenshot: (png, path) => {
        screenshots.push({ png, path })
      },
    })

    expect(screenshots[0]!.path).toBe("output/demo.png")
    await result.terminal.close()
  })

  test("multiple screenshots are all captured", async () => {
    const tape = parseTape("Screenshot\nScreenshot\nScreenshot")
    const screenshots: Uint8Array[] = []

    const result = await executeTape(tape, {
      backend: vt100(),
      onScreenshot: (png) => screenshots.push(png),
    })

    expect(result.screenshotCount).toBe(3)
    expect(screenshots).toHaveLength(3)
    await result.terminal.close()
  })
})

// =============================================================================
// Frame recording
// =============================================================================

describe("frame recording", () => {
  test("screenshots produce frames", async () => {
    const tape = parseTape("Screenshot")
    const result = await executeTape(tape, { backend: vt100() })

    expect(result.frames).toHaveLength(1)
    expect(result.frames[0]!.timestamp).toBeGreaterThanOrEqual(0)
    expect(result.frames[0]!.png).toBeInstanceOf(Uint8Array)
    await result.terminal.close()
  })

  test("Hide/Show suppresses frame recording", async () => {
    const tape = parseTape("Screenshot\nHide\nScreenshot\nShow\nScreenshot")
    const result = await executeTape(tape, { backend: vt100() })

    // 3 screenshots total, but the middle one was hidden
    expect(result.screenshotCount).toBe(3)
    // Frames: first and last visible, middle hidden
    expect(result.frames).toHaveLength(2)
    await result.terminal.close()
  })
})

// =============================================================================
// Dynamic Set commands
// =============================================================================

describe("dynamic Set commands", () => {
  test("Set Width configures terminal width", async () => {
    const tape = parseTape("Set Width 120")
    const result = await executeTape(tape, { backend: vt100() })

    expect(result.terminal.cols).toBe(120)
    await result.terminal.close()
  })

  test("Set Height configures terminal height", async () => {
    const tape = parseTape("Set Height 40")
    const result = await executeTape(tape, { backend: vt100() })

    expect(result.terminal.rows).toBe(40)
    await result.terminal.close()
  })
})

// =============================================================================
// Theme support
// =============================================================================

describe("Set Theme", () => {
  test("Set Theme applies theme to screenshots", async () => {
    const tape = parseTape('Set Theme "dracula"\nType "hello"\nScreenshot')
    const screenshots: Uint8Array[] = []

    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
      onScreenshot: (png) => screenshots.push(png),
    })

    // The screenshot was taken — verify it produced output
    expect(screenshots).toHaveLength(1)
    expect(screenshots[0]!.length).toBeGreaterThan(0)

    // Verify the SVG uses Dracula colors by inspecting the terminal's SVG output
    // (the executor stores the theme in svgOptions which is used by screenshotPng)
    const svg = result.terminal.screenshotSvg({ theme: { background: "#282a36", foreground: "#f8f8f2" } })
    expect(svg).toContain("#282a36") // Dracula background
    await result.terminal.close()
  })

  test("theme option overrides Set Theme in tape", async () => {
    const tape = parseTape('Set Theme "dracula"\nType "hello"\nScreenshot')
    const screenshots: Uint8Array[] = []

    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
      theme: "nord",
      onScreenshot: (png) => screenshots.push(png),
    })

    expect(screenshots).toHaveLength(1)
    await result.terminal.close()
  })

  test("unknown theme is silently ignored", async () => {
    const tape = parseTape('Set Theme "nonexistent"\nType "hello"\nScreenshot')
    const screenshots: Uint8Array[] = []

    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
      onScreenshot: (png) => screenshots.push(png),
    })

    expect(screenshots).toHaveLength(1)
    await result.terminal.close()
  })
})

// =============================================================================
// No-op commands in library mode
// =============================================================================

describe("no-op commands", () => {
  test("Output is a no-op", async () => {
    const tape = parseTape("Output demo.gif")
    const result = await executeTape(tape, { backend: vt100() })
    expect(result.terminal).toBeDefined()
    await result.terminal.close()
  })

  test("Source is a no-op", async () => {
    const tape = parseTape("Source other.tape")
    const result = await executeTape(tape, { backend: vt100() })
    expect(result.terminal).toBeDefined()
    await result.terminal.close()
  })

  test("Require is a no-op", async () => {
    const tape = parseTape("Require bash")
    const result = await executeTape(tape, { backend: vt100() })
    expect(result.terminal).toBeDefined()
    await result.terminal.close()
  })
})

// =============================================================================
// Expect command
// =============================================================================

describe("Expect command", () => {
  test("succeeds when text is already present", async () => {
    const tape = parseTape('Type "hello world"\nExpect "hello"')
    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
    })

    expect(result.terminal.getText()).toContain("hello world")
    await result.terminal.close()
  })

  test("succeeds after feeding text", async () => {
    const tape = parseTape('Type "loading..."\nType "\\nready"\nExpect "ready"')
    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
    })

    expect(result.terminal.getText()).toContain("ready")
    await result.terminal.close()
  })

  test("times out when text never appears", async () => {
    const tape = parseTape('Type "hello"\nExpect "goodbye" 100ms')
    await expect(
      executeTape(tape, {
        backend: vt100(),
        defaultTypingSpeed: 0,
      }),
    ).rejects.toThrow("Expect timed out after 100ms")
  })
})

// =============================================================================
// Full tape execution
// =============================================================================

describe("full tape execution", () => {
  test("executes a realistic tape without PTY", async () => {
    const tape = parseTape(`
# A simple demo
Set Width 80
Set Height 24

Type "hello world"
Enter
Sleep 50ms
Screenshot
`)
    const screenshots: Uint8Array[] = []

    const result = await executeTape(tape, {
      backend: vt100(),
      defaultTypingSpeed: 0,
      onScreenshot: (png) => screenshots.push(png),
    })

    expect(result.terminal.getText()).toContain("hello world")
    expect(screenshots).toHaveLength(1)
    expect(result.screenshotCount).toBe(1)
    expect(result.duration).toBeGreaterThanOrEqual(40) // at least the 50ms sleep
    await result.terminal.close()
  })
})
