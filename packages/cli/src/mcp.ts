/**
 * termless MCP Server — terminal session management over MCP stdio.
 *
 * Same 8 tools as the playwright-tty MCP server, but backed by termless
 * (xterm.js headless + Bun PTY). No Chromium dependency — screenshots are SVG or PNG.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
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
function safeTool<T>(
  fn: (args: T) => Promise<{ content: Array<{ type: string; [k: string]: unknown }> }>,
): (args: T) => Promise<{ content: Array<{ type: string; [k: string]: unknown }> }> {
  return async (args: T) => {
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

// ── Server ──

export async function startMcpServer(): Promise<void> {
  const sessions = createSessionManager()
  const server = new McpServer({ name: "termless", version: "0.1.0" })

  // start — Create terminal session
  server.registerTool(
    "start",
    {
      description: "Start a terminal session with a PTY and xterm-headless emulator",
      inputSchema: {
        command: z.array(z.string()).describe("Command to run (e.g. ['bun', 'km', 'view', '/path'])"),
        env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
        cols: z.number().default(120).describe("Terminal columns (default: 120)"),
        rows: z.number().default(40).describe("Terminal rows (default: 40)"),
        waitFor: z
          .union([z.literal("content"), z.literal("stable"), z.string()])
          .optional()
          .describe("Wait condition: 'content', 'stable', or specific text"),
        timeout: z.number().default(5000).describe("Timeout in ms for waitFor condition (default: 5000)"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    safeTool(async (args) => {
      const { id, terminal } = await sessions.createSession({
        command: args.command,
        env: args.env,
        cols: args.cols,
        rows: args.rows,
        waitFor: args.waitFor,
        timeout: args.timeout,
        cwd: args.cwd,
      })

      return textResult({
        sessionId: id,
        cols: terminal.cols,
        rows: terminal.rows,
        alive: terminal.alive,
        text: terminal.getText(),
      })
    }),
  )

  // stop — Kill session
  server.registerTool(
    "stop",
    {
      description: "Stop a terminal session and kill the process",
      inputSchema: {
        sessionId: z.string().describe("Session ID to stop"),
      },
    },
    safeTool(async (args) => {
      await sessions.stopSession(args.sessionId)
      return textResult({ stopped: args.sessionId })
    }),
  )

  // list — List active sessions
  server.registerTool(
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
  server.registerTool(
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
  server.registerTool(
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
  server.registerTool(
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

  // screenshot — SVG or PNG screenshot
  server.registerTool(
    "screenshot",
    {
      description: "Capture a screenshot of the terminal (SVG or PNG, no browser needed)",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
        outputPath: z
          .string()
          .optional()
          .describe("File path to save screenshot (PNG if .png extension, otherwise SVG)"),
        format: z
          .enum(["svg", "png"])
          .default("svg")
          .describe("Output format (default: svg). When outputPath is set, format is detected from extension."),
      },
    },
    safeTool(async (args) => {
      const terminal = sessions.getSession(args.sessionId)
      const isPng = args.format === "png" || args.outputPath?.endsWith(".png")

      if (args.outputPath) {
        const { writeFile } = await import("node:fs/promises")
        if (isPng) {
          const png = await terminal.screenshotPng()
          await writeFile(args.outputPath, png)
        } else {
          const svg = terminal.screenshotSvg()
          await writeFile(args.outputPath, svg, "utf-8")
        }
        return textResult({ saved: args.outputPath, format: isPng ? "png" : "svg" })
      }

      if (isPng) {
        const png = await terminal.screenshotPng()
        const base64 = Buffer.from(png).toString("base64")
        return { content: [{ type: "image", data: base64, mimeType: "image/png" }] }
      }

      return { content: [{ type: "text", text: terminal.screenshotSvg() }] }
    }),
  )

  // wait — Wait for text/stability
  server.registerTool(
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
