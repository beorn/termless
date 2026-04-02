/**
 * Tests for multi-backend tape comparison.
 *
 * Verifies that compareTape runs against multiple backends and produces
 * the correct number of outputs with appropriate composition.
 * Uses createVt100Backend() directly to avoid registry resolution issues.
 */

import { describe, test, expect } from "vitest"
import { parseTape } from "../../src/tape/parser.ts"
import { compareTape } from "../../src/tape/compare.ts"
import { createVt100Backend } from "../../packages/vt100/src/backend.ts"

// =============================================================================
// Helpers
// =============================================================================

/** Simple tape that writes text and takes a screenshot. */
const SIMPLE_TAPE = parseTape(`
Type "hello"
Screenshot
`)

/** Create a named backend spec for compareTape. */
function vt100Spec(name = "vt100") {
  return { name, backend: createVt100Backend() }
}

// =============================================================================
// Separate mode
// =============================================================================

describe("separate mode", () => {
  test("produces one screenshot per backend", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec()],
      mode: "separate",
    })

    expect(result.screenshots).toHaveLength(1)
    expect(result.screenshots[0]!.backend).toBe("vt100")
    expect(result.screenshots[0]!.png).toBeInstanceOf(Uint8Array)
    expect(result.screenshots[0]!.png.length).toBeGreaterThan(0)
    expect(result.screenshots[0]!.text).toContain("hello")
  })

  test("runs against multiple backends", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec("vt100-a"), vt100Spec("vt100-b")],
      mode: "separate",
    })

    expect(result.screenshots).toHaveLength(2)
    expect(result.screenshots[0]!.backend).toBe("vt100-a")
    expect(result.screenshots[1]!.backend).toBe("vt100-b")
  })

  test("no composed SVG in separate mode", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec()],
      mode: "separate",
    })

    expect(result.composedSvg).toBeUndefined()
  })

  test("textMatch is true when backends produce same output", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec("a"), vt100Spec("b")],
      mode: "separate",
    })

    expect(result.textMatch).toBe(true)
  })
})

// =============================================================================
// Side-by-side mode
// =============================================================================

describe("side-by-side mode", () => {
  test("produces composed SVG", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec("a"), vt100Spec("b")],
      mode: "side-by-side",
    })

    expect(result.composedSvg).toBeDefined()
    expect(result.composedSvg).toContain("<svg")
    expect(result.composedSvg).toContain("</svg>")
  })

  test("composed SVG contains backend names", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec("alpha"), vt100Spec("beta")],
      mode: "side-by-side",
    })

    expect(result.composedSvg).toContain("alpha")
    expect(result.composedSvg).toContain("beta")
  })

  test("composed SVG embeds PNG images as base64", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec()],
      mode: "side-by-side",
    })

    expect(result.composedSvg).toContain("data:image/png;base64,")
  })
})

// =============================================================================
// Grid mode
// =============================================================================

describe("grid mode", () => {
  test("produces composed SVG", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec("a"), vt100Spec("b")],
      mode: "grid",
    })

    expect(result.composedSvg).toBeDefined()
    expect(result.composedSvg).toContain("<svg")
  })

  test("grid with single backend still produces SVG", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec()],
      mode: "grid",
    })

    expect(result.composedSvg).toBeDefined()
  })
})

// =============================================================================
// Diff mode
// =============================================================================

describe("diff mode", () => {
  test("produces composed SVG with diff info", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec("a"), vt100Spec("b")],
      mode: "diff",
    })

    expect(result.composedSvg).toBeDefined()
    expect(result.composedSvg).toContain("<svg")
    expect(result.composedSvg).toContain("identical text output")
  })

  test("diff with single backend falls back to side-by-side", async () => {
    const result = await compareTape(SIMPLE_TAPE, {
      backends: [vt100Spec()],
      mode: "diff",
    })

    expect(result.composedSvg).toBeDefined()
  })
})

// =============================================================================
// Screenshot fallback
// =============================================================================

describe("screenshot handling", () => {
  test("takes final screenshot if tape has none", async () => {
    const noScreenshotTape = parseTape('Type "no explicit screenshot"')

    const result = await compareTape(noScreenshotTape, {
      backends: [vt100Spec()],
      mode: "separate",
    })

    expect(result.screenshots).toHaveLength(1)
    expect(result.screenshots[0]!.png.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// Executor options passthrough
// =============================================================================

describe("executor options", () => {
  test("passes executor options to each backend run", async () => {
    const tape = parseTape("Set Width 100\nScreenshot")

    const result = await compareTape(tape, {
      backends: [vt100Spec()],
      mode: "separate",
      executorOptions: {
        defaultTypingSpeed: 0,
      },
    })

    expect(result.screenshots).toHaveLength(1)
  })
})
