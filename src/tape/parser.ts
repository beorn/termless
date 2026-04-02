/**
 * VHS .tape format parser for termless.
 *
 * Parses the line-based VHS tape format into structured TapeCommand objects.
 * The format is documented at https://github.com/charmbracelet/vhs
 *
 * @example
 * ```ts
 * import { parseTape } from "@termless/core"
 *
 * const tape = parseTape(`
 *   Output demo.gif
 *   Set FontSize 14
 *   Type "hello world"
 *   Enter
 *   Sleep 2s
 *   Screenshot
 * `)
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export type TapeCommand =
  | { type: "output"; path: string }
  | { type: "set"; key: string; value: string }
  | { type: "type"; text: string; speed?: number }
  | { type: "key"; key: string; count?: number }
  | { type: "ctrl"; key: string }
  | { type: "alt"; key: string }
  | { type: "sleep"; ms: number }
  | { type: "screenshot"; path?: string }
  | { type: "expect"; text: string; timeout?: number }
  | { type: "hide" }
  | { type: "show" }
  | { type: "source"; path: string }
  | { type: "require"; program: string }

export interface TapeFile {
  commands: TapeCommand[]
  settings: Record<string, string>
}

// =============================================================================
// Duration parsing
// =============================================================================

/**
 * Parse a duration string into milliseconds.
 *
 * Supports: "2s" -> 2000, "500ms" -> 500, "0.5s" -> 500, "100" -> 100 (ms).
 */
export function parseDuration(s: string): number {
  const trimmed = s.trim()
  if (trimmed.endsWith("ms")) {
    return Number.parseFloat(trimmed.slice(0, -2))
  }
  if (trimmed.endsWith("s")) {
    return Number.parseFloat(trimmed.slice(0, -1)) * 1000
  }
  // Bare number treated as milliseconds
  return Number.parseFloat(trimmed)
}

// =============================================================================
// Key command names (case-insensitive match)
// =============================================================================

const KEY_COMMANDS = new Set([
  "enter",
  "backspace",
  "tab",
  "space",
  "up",
  "down",
  "left",
  "right",
  "escape",
  "delete",
  "pageup",
  "pagedown",
  "home",
  "end",
])

// =============================================================================
// Line parsing
// =============================================================================

/**
 * Parse a quoted string, handling escaped quotes.
 * Returns the unquoted content.
 */
function parseQuotedString(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
  return s
}

/**
 * Parse a single line into a TapeCommand, or null for comments/blank lines.
 */
function parseLine(line: string): TapeCommand | null {
  const trimmed = line.trim()

  // Skip empty lines and comments
  if (trimmed === "" || trimmed.startsWith("#")) return null

  // Split into command and arguments
  // Handle quoted strings properly
  const parts = splitCommandLine(trimmed)
  if (parts.length === 0) return null

  const cmd = parts[0]!
  const cmdLower = cmd.toLowerCase()

  // Output <path>
  if (cmdLower === "output") {
    return { type: "output", path: parts.slice(1).join(" ") }
  }

  // Set <key> <value>
  if (cmdLower === "set") {
    const key = parts[1] ?? ""
    const value = parts.slice(2).join(" ")
    return { type: "set", key, value: parseQuotedString(value) }
  }

  // Type[@speed] "text"
  if (cmdLower === "type" || cmdLower.startsWith("type@")) {
    let speed: number | undefined
    if (cmdLower.startsWith("type@")) {
      speed = parseDuration(cmd.slice(5))
    }
    const text = parseQuotedString(parts.slice(1).join(" "))
    return { type: "type", text, ...(speed !== undefined ? { speed } : {}) }
  }

  // Ctrl+<key>
  if (cmdLower.startsWith("ctrl+")) {
    return { type: "ctrl", key: cmd.slice(5) }
  }

  // Alt+<key>
  if (cmdLower.startsWith("alt+")) {
    return { type: "alt", key: cmd.slice(4) }
  }

  // Sleep <duration>
  if (cmdLower === "sleep") {
    const duration = parts[1] ?? "0"
    return { type: "sleep", ms: parseDuration(duration) }
  }

  // Screenshot [path]
  if (cmdLower === "screenshot") {
    const path = parts.length > 1 ? parts.slice(1).join(" ") : undefined
    return { type: "screenshot", path }
  }

  // Hide
  if (cmdLower === "hide") {
    return { type: "hide" }
  }

  // Show
  if (cmdLower === "show") {
    return { type: "show" }
  }

  // Source <path>
  if (cmdLower === "source") {
    return { type: "source", path: parts.slice(1).join(" ") }
  }

  // Require <program>
  if (cmdLower === "require") {
    return { type: "require", program: parts[1] ?? "" }
  }

  // Expect "text" [timeout]
  if (cmdLower === "expect") {
    const text = parseQuotedString(parts[1] ?? "")
    let timeout: number | undefined
    if (parts.length > 2) {
      timeout = parseDuration(parts[2]!)
    }
    return { type: "expect", text, ...(timeout !== undefined ? { timeout } : {}) }
  }

  // Key commands: Enter, Backspace, Tab, Space, Up, Down, Left, Right, Escape, Delete
  if (KEY_COMMANDS.has(cmdLower)) {
    const count = parts.length > 1 ? Number.parseInt(parts[1]!, 10) : undefined
    return { type: "key", key: cmd, ...(count !== undefined && count > 1 ? { count } : {}) }
  }

  // Unknown command — treat as key press (VHS is lenient)
  return { type: "key", key: cmd }
}

/**
 * Split a command line into parts, respecting quoted strings.
 */
function splitCommandLine(line: string): string[] {
  const parts: string[] = []
  let current = ""
  let inQuote = false
  let escaped = false

  for (const ch of line) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === "\\") {
      escaped = true
      current += ch
      continue
    }
    if (ch === '"') {
      inQuote = !inQuote
      current += ch
      continue
    }
    if (ch === " " && !inQuote) {
      if (current.length > 0) {
        parts.push(current)
        current = ""
      }
      continue
    }
    current += ch
  }

  if (current.length > 0) {
    parts.push(current)
  }

  return parts
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a VHS .tape file format string into a TapeFile.
 *
 * The tape format is line-based. Each line is either:
 * - A comment (starting with #)
 * - A blank line (ignored)
 * - A command (Output, Set, Type, Enter, Sleep, Screenshot, etc.)
 *
 * Set commands are collected into the `settings` map in addition to
 * appearing in the `commands` array.
 */
export function parseTape(source: string): TapeFile {
  const lines = source.split("\n")
  const commands: TapeCommand[] = []
  const settings: Record<string, string> = {}

  for (const line of lines) {
    const cmd = parseLine(line)
    if (cmd === null) continue

    commands.push(cmd)

    // Collect Set commands into settings
    if (cmd.type === "set") {
      settings[cmd.key] = cmd.value
    }
  }

  return { commands, settings }
}
