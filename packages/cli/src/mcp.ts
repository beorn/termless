/**
 * termless MCP Server — drive and observe terminal sessions over MCP stdio.
 *
 * The tools map onto the recording-domain vocabulary (three objects —
 * Backend, TestTerminal, Recording — and four verbs — record · view · play ·
 * compare), so an agent reading the tool list sees the same verbs the
 * `termless` CLI exposes, not a separate vocabulary:
 *
 * - `start` / `stop` / `list` / `press` / `type` / `text` / `wait` drive a
 *   *live* TestTerminal object — open a session, send input, read state, close it.
 *   These are TestTerminal operations, not recording verbs.
 * - `screenshot` is a one-frame **view**: it renders the live TestTerminal's
 *   current buffer to a PNG/SVG image.
 * - `start({ trace: { dir } })` turns the session into a **record**: every
 *   buffer mutation is captured as a frame. `trace` then **views** the
 *   recorded frames; `stop` finalizes the recording.
 * - `compat-screenshot` is a one-frame **view** captured against the
 *   peekaboo backend — a real desktop terminal app instead of a headless one.
 *
 * Backed by termless (headless terminal backend + Bun PTY). No Chromium
 * dependency — screenshots render via a native canvas / SVG pipeline.
 *
 * The `mcp__tty__*` tool names are a stable external contract (agents invoke
 * them by name); they are not renamed to the verb words. Descriptions, not
 * identifiers, carry the verb mapping.
 */

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createFrameTracer, type FrameTracer } from "@termless/core"
import { z } from "zod"
import { createSessionManager } from "./session.ts"

// ── Error handling ──

process.on("uncaughtException", (err) => {
  console.error("[termless-mcp] uncaughtException:", err.stack ?? err.message)
})
process.on("unhandledRejection", (err) => {
  console.error("[termless-mcp] unhandledRejection:", err instanceof Error ? (err.stack ?? err.message) : err)
})

/** Wrap a tool handler so errors become MCP error responses, not process crashes */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeTool(fn: (args: any) => Promise<{ content: Array<{ type: string; [k: string]: unknown }> }>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (args: any) => {
    try {
      return await fn(args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[termless-mcp] tool error: ${msg}`)
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true }
    }
  }
}

// ── Helpers ──

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
}

/** Type-safe registerTool that bridges safeTool's return type to McpServer's expected handler type */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function register(srv: McpServer, name: string, schema: any, handler: any): void {
  srv.registerTool(name, schema, handler)
}

// ── Server ──

export async function startMcpServer(): Promise<void> {
  const sessions = createSessionManager()
  const server = new McpServer({ name: "termless", version: "0.1.0" })

  // start — Open a live TestTerminal session (optionally recording its frames)
  register(
    server,
    "start",
    {
      description:
        "Open a live terminal session — a TestTerminal object backed by a PTY and a headless terminal emulator backend. Default backend is xtermjs (fast, portable, lower visual fidelity). Use 'ghostty' for visual-faithful screenshots (truecolor + full glyph coverage matching the real Ghostty terminal) — required for visual-bug-close Layer 2 evidence. Pass `trace: { dir }` to also *record* the session: every buffer mutation is captured as a debounced PNG + JSONL frame. Read the recorded frames with the `trace` tool; finalize the recording with `stop`.",
      inputSchema: {
        command: z.array(z.string()).describe("Command to run (e.g. ['bun', 'km', 'view', '/path'])"),
        env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
        cols: z.number().default(120).describe("TestTerminal columns (default: 120)"),
        rows: z.number().default(40).describe("TestTerminal rows (default: 40)"),
        waitFor: z
          .union([z.literal("content"), z.literal("stable"), z.string()])
          .optional()
          .describe("Wait condition: 'content', 'stable', or specific text"),
        timeout: z.number().default(5000).describe("Timeout in ms for waitFor condition (default: 5000)"),
        cwd: z.string().optional().describe("Working directory"),
        backend: z
          .enum(["xtermjs", "ghostty", "vterm", "vt100", "peekaboo"])
          .optional()
          .describe(
            "TestTerminal emulator backend. 'xtermjs' (default) — fast, portable, 256-color fallback. 'ghostty' — ghostty-web WASM, truecolor + full glyph coverage, matches real Ghostty rendering (use for visual-bug screenshots). 'vterm' — pure-TS standards-compliant. 'vt100' — minimal VT100 subset. 'peekaboo' — OS automation against a real terminal app (macOS only, slowest, pixel-perfect).",
          ),
        trace: z
          .object({
            dir: z.string().describe("Directory to persist trace artifacts (index.jsonl + NNNNN.png)"),
            debounceMs: z
              .number()
              .default(16)
              .describe("Debounce window between captures (default 16ms = one render frame at 60fps)"),
            maxFrames: z.number().default(10_000).describe("Safety cap; tracer halts after N frames"),
            dedupe: z
              .boolean()
              .default(true)
              .describe("Skip writing PNGs for hash-identical buffer states (still recorded in index)"),
            fontPath: z
              .string()
              .optional()
              .describe("Absolute path to a .ttf/.otf font for the renderer (improves glyph fidelity)"),
          })
          .optional()
          .describe(
            "Record this session. When set, every buffer mutation is captured (debounced) as a frame and persisted as a PNG + index.jsonl row in `dir`. View the recorded frames via the `trace` tool; finalize the recording via `stop`.",
          ),
      },
    },
    safeTool(async (args) => {
      // Late-bound tracer reference so the `onAfterWrite` hook can dispatch to
      // it once createSession() returns (mirrors the bearly tty pattern). The
      // closure captures `tracer` by reference; the assignment below patches
      // it in before any PTY data flows.
      let tracer: FrameTracer | null = null
      const { id, terminal } = await sessions.createSession({
        command: args.command,
        env: args.env,
        cols: args.cols,
        rows: args.rows,
        waitFor: args.waitFor,
        timeout: args.timeout,
        cwd: args.cwd,
        backend: args.backend,
        onAfterWrite: args.trace ? (data: Uint8Array) => tracer?.onWrite(data) : undefined,
      })

      if (args.trace) {
        tracer = createFrameTracer(terminal, {
          dir: args.trace.dir,
          debounceMs: args.trace.debounceMs,
          maxFrames: args.trace.maxFrames,
          dedupe: args.trace.dedupe,
          canvas: {
            cols: args.cols,
            rows: args.rows,
            fontPath: args.trace.fontPath,
          },
        })
        sessions.attachTracer(id, tracer, args.trace.dir)
      }

      return textResult({
        sessionId: id,
        cols: terminal.cols,
        rows: terminal.rows,
        alive: terminal.alive,
        text: terminal.getText(),
        trace: args.trace ? { dir: args.trace.dir } : null,
      })
    }),
  )

  // stop — Close the live TestTerminal session (finalize the recording if any)
  register(
    server,
    "stop",
    {
      description:
        "Close a terminal session and kill the process. If the session was recording (opened via `start({ trace: {...} })`), the recording is finalized first and its summary is returned in the `trace` field.",
      inputSchema: {
        sessionId: z.string().describe("Session ID to stop"),
      },
    },
    safeTool(async (args) => {
      const tracer = sessions.getTracer(args.sessionId)
      const traceSummary = tracer ? await tracer.stop() : null
      await sessions.stopSession(args.sessionId)
      return textResult({ stopped: args.sessionId, trace: traceSummary })
    }),
  )

  // list — List active sessions
  register(
    server,
    "list",
    {
      description: "List all active terminal sessions",
      inputSchema: {},
    },
    safeTool(async () => {
      return textResult({ sessions: sessions.listSessions() })
    }),
  )

  // press — Send key press
  register(
    server,
    "press",
    {
      description: "Press a keyboard key (e.g. 'Enter', 'ArrowDown', 'Control+c', 'j')",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
        key: z.string().describe("Key to press (Playwright key format)"),
      },
    },
    safeTool(async (args) => {
      const terminal = sessions.getSession(args.sessionId)
      terminal.press(args.key)
      // Brief settle time after key press
      await new Promise((resolve) => setTimeout(resolve, 50))
      return textResult({ pressed: args.key, text: terminal.getText() })
    }),
  )

  // type — Type text
  register(
    server,
    "type",
    {
      description: "Type text into the terminal",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
        text: z.string().describe("Text to type"),
      },
    },
    safeTool(async (args) => {
      const terminal = sessions.getSession(args.sessionId)
      terminal.type(args.text)
      // Brief settle time after typing
      await new Promise((resolve) => setTimeout(resolve, 50))
      return textResult({ typed: args.text, text: terminal.getText() })
    }),
  )

  // text — Get terminal text
  register(
    server,
    "text",
    {
      description: "Get the text content of the terminal",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
      },
    },
    safeTool(async (args) => {
      const terminal = sessions.getSession(args.sessionId)
      return textResult({ text: terminal.getText() })
    }),
  )

  // screenshot — View the live TestTerminal as a one-frame image (PNG or SVG)
  register(
    server,
    "screenshot",
    {
      description:
        "View the live terminal as a single-frame image. Renders the TestTerminal's current buffer to a high-fidelity PNG via the auto-picker (TestTerminal.screenshot — backend-native renderer → @termless/ghostty native canvas → resvg fallback). No Chromium / Playwright dependency. SVG output stays accessible via `.svg` extension on outputPath or `format: 'svg'`.",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
        outputPath: z
          .string()
          .optional()
          .describe(
            "File path to save screenshot. PNG by default; `.svg` extension routes to vector output. When unset, PNG bytes are returned as base64 in the response.",
          ),
        format: z
          .enum(["svg", "png"])
          .optional()
          .describe(
            "Output format. Default 'png'. Overrides outputPath-extension detection. Use 'svg' for the deterministic vector path.",
          ),
        fontPath: z
          .string()
          .optional()
          .describe(
            "Absolute path to a .ttf/.otf font file to bundle for the render (improves glyph fidelity for Nerd Fonts, emojis, box-drawing).",
          ),
        fontSize: z.number().optional().describe("Font size in CSS pixels"),
        fontFamily: z.string().optional().describe("CSS font-family list"),
        cols: z.number().optional().describe("Override session cols for the render"),
        rows: z.number().optional().describe("Override session rows for the render"),
        dpr: z.number().optional().describe("Device pixel ratio (default 2)"),
        cellWidth: z.number().optional().describe("Override per-cell pixel width (logical CSS pixels, pre-DPR)"),
        cellHeight: z.number().optional().describe("Override per-cell pixel height (logical CSS pixels, pre-DPR)"),
        theme: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Color palette override (foreground, background, cursor, black, red, green, yellow, blue, magenta, cyan, white, brightBlack, ...)",
          ),
      },
    },
    safeTool(async (args) => {
      const terminal = sessions.getSession(args.sessionId)
      const isSvg = args.format === "svg" || (args.format == null && args.outputPath?.endsWith(".svg"))

      if (isSvg) {
        const svg = terminal.screenshotSvg()
        if (args.outputPath) {
          await writeFile(args.outputPath, svg, "utf-8")
          return textResult({ saved: args.outputPath, format: "svg", mimeType: "image/svg+xml" })
        }
        return { content: [{ type: "text", text: svg }] }
      }

      // PNG path — auto-picker on TestTerminal: backend-native (ghostty) →
      // @termless/ghostty proxy → resvg fallback. Same fidelity contract as
      // bearly's tty_screenshot but without the Chromium / Playwright launch.
      const png = await terminal.screenshot({
        fontPath: args.fontPath,
        fontSize: args.fontSize,
        fontFamily: args.fontFamily,
        cols: args.cols,
        rows: args.rows,
        dpr: args.dpr,
        cellWidth: args.cellWidth,
        cellHeight: args.cellHeight,
        theme: args.theme,
      })

      if (args.outputPath) {
        await writeFile(args.outputPath, png)
        return textResult({ saved: args.outputPath, format: "png", mimeType: "image/png" })
      }

      return {
        content: [{ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" }],
      }
    }),
  )

  // wait — Wait for text/stability
  register(
    server,
    "wait",
    {
      description: "Wait for specific text or terminal stability",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
        for: z.string().optional().describe("Text to wait for"),
        stable: z.number().optional().describe("Wait for terminal stability (milliseconds)"),
        timeout: z.number().default(30000).describe("Timeout in milliseconds"),
      },
    },
    safeTool(async (args) => {
      const terminal = sessions.getSession(args.sessionId)

      if (args.for) {
        await terminal.waitFor(args.for, args.timeout)
      } else {
        await terminal.waitForStable(args.stable ?? 200, args.timeout)
      }

      return textResult({ text: terminal.getText() })
    }),
  )

  // trace — View the frames recorded by a session (since a sequence number)
  register(
    server,
    "trace",
    {
      description:
        "View the frames recorded for a session — returns Frame[] captured since `since` (sequence number) from the in-memory ring buffer. The cursor does NOT auto-advance — the caller passes the seq of the last frame seen. Requires the session to have been opened as a recording via `start({ trace: {...} })`.",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
        since: z
          .number()
          .default(0)
          .describe("Return frames with seq > since (default 0 = all). Mutually exclusive with sinceTs."),
        sinceTs: z
          .number()
          .optional()
          .describe("Return frames with ts >= sinceTs (ms epoch). When set, takes precedence over `since`."),
        includePngBytes: z
          .boolean()
          .default(false)
          .describe(
            "Include base64-encoded PNG bytes inline with each frame (default false — only metadata + relative path).",
          ),
      },
    },
    safeTool(async (args) => {
      const tracer = sessions.getTracer(args.sessionId)
      if (!tracer) {
        return textResult({
          error:
            "This session is not recording. Open it as a recording by passing `trace: { dir }` to mcp__tty__start.",
        })
      }
      const frames =
        args.sinceTs != null ? tracer.framesSinceTime(args.sinceTs) : tracer.framesSinceSeq(args.since ?? 0)

      if (!args.includePngBytes) {
        return textResult({ frames, count: frames.length })
      }

      // Resolve each frame's PNG against the trace `dir` captured at start.
      // Duplicate frames have png === null; the consumer dereferences via
      // duplicate_of. Read failures degrade gracefully (frame returned
      // without pngBytes) instead of blowing up the entire response.
      const dir = sessions.getTraceDir(args.sessionId)
      const enriched = await Promise.all(
        frames.map(async (f) => {
          if (!f.png || !dir) return f
          try {
            const bytes = await readFile(join(dir, f.png))
            return { ...f, pngBytes: Buffer.from(bytes).toString("base64") }
          } catch {
            return f
          }
        }),
      )
      return textResult({ frames: enriched, count: enriched.length })
    }),
  )

  // compat-screenshot — View a TUI in a real desktop terminal app (compat backend)
  register(
    server,
    "compat-screenshot",
    {
      description:
        "View a TUI as a one-frame image, captured against the peekaboo backend — the user's ACTUAL desktop terminal app (Ghostty / kitty / iTerm / TestTerminal.app) via macOS screencapture. Pixel-perfect for that specific terminal + the user's real font/theme config — the COMPAT path. Use this ONLY for terminal-specific compat bugs ('does it look right in Ghostty 1.3 with my Tokyo Night theme?'). For routine visual iteration use the `screenshot` tool (headless canvas renderer — fast, no GUI, cross-platform). macOS-only; needs a GUI session + Screen Recording permission. Spawns and then closes a real window.",
      inputSchema: {
        cmd: z.string().describe("TUI command to run as a shell string (e.g. 'bun km view ~/Vault')"),
        terminal: z
          .enum(["ghostty", "kitty", "iterm", "terminal"])
          .optional()
          .describe("TestTerminal app. Auto-detected (ghostty > kitty > iterm > terminal) if omitted."),
        outputPath: z.string().optional().describe("Output PNG path. A temp file is used if omitted."),
        cols: z.number().default(120).describe("Requested terminal columns (best-effort sizing; default 120)"),
        rows: z.number().default(40).describe("Requested terminal rows (best-effort sizing; default 40)"),
        cwd: z.string().optional().describe("Working directory for the TUI command"),
        waitFor: z
          .string()
          .optional()
          .describe("Text pattern to wait for before screenshotting (default: any non-empty text)"),
        waitTimeoutMs: z.number().default(10_000).describe("First-paint wait timeout in ms (default 10000)"),
        keep: z.boolean().default(false).describe("Keep the spawned terminal window open after the screenshot"),
      },
    },
    safeTool(async (args) => {
      const { compatScreenshot } = await import("@termless/peekaboo")
      const result = await compatScreenshot({
        cmd: args.cmd,
        terminal: args.terminal,
        outputPath: args.outputPath,
        cols: args.cols,
        rows: args.rows,
        cwd: args.cwd,
        waitFor: args.waitFor,
        waitTimeoutMs: args.waitTimeoutMs,
        keep: args.keep,
      })
      return textResult(result)
    }),
  )

  // ── Shutdown ──

  process.on("SIGINT", () => {
    void sessions.stopAll().then(() => process.exit(0))
  })
  process.on("SIGTERM", () => {
    void sessions.stopAll().then(() => process.exit(0))
  })

  // ── Connect ──

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
