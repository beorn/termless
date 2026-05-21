/**
 * Key parsing and ANSI encoding for termless.
 *
 * Converts human-readable key descriptions (e.g., "Ctrl+a", "ArrowUp", "F5")
 * into KeyDescriptor objects and ANSI escape sequences suitable for PTY input.
 */

import type { KeyDescriptor } from "./types.ts"

// ── Named key → ANSI sequence map ──

const KEY_MAP: Record<string, string | null> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowLeft: "\x1b[D",
  ArrowRight: "\x1b[C",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Enter: "\r",
  Tab: "\t",
  Backspace: "\x7f",
  Delete: "\x1b[3~",
  Escape: "\x1b",
  Space: " ",
  // Pure modifier keys produce no output on their own
  Control: null,
  Shift: null,
  Alt: null,
  Meta: null,
}

// ── Function keys F1-F12 ──

const FKEY_MAP: Record<string, string> = {
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
}

// ── Modifier aliases ──

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: "ctrl",
  control: "ctrl",
  shift: "shift",
  alt: "alt",
  meta: "super",
  cmd: "super",
  option: "alt",
  super: "super",
}

function normalizeModifier(mod: string): string {
  return MODIFIER_ALIASES[mod.toLowerCase()] ?? mod.toLowerCase()
}

/**
 * Parse a key string like "Ctrl+a", "ArrowUp", "Shift+Tab" into a KeyDescriptor.
 *
 * Supports modifier prefixes: Ctrl, Control, Alt, Shift, Meta, Cmd, Option, Super.
 * Modifiers are case-insensitive and separated by "+".
 */
export function parseKey(key: string): KeyDescriptor {
  const parts = key.split("+")
  const mainKey = parts.pop()!
  const result: KeyDescriptor = { key: mainKey }

  for (const part of parts) {
    const normalized = normalizeModifier(part)
    switch (normalized) {
      case "ctrl":
        result.ctrl = true
        break
      case "shift":
        result.shift = true
        break
      case "alt":
        result.alt = true
        break
      case "super":
        result.super = true
        break
    }
  }

  return result
}

/**
 * Convert a key descriptor or key string to its ANSI escape sequence.
 *
 * Handles:
 * - Single characters: returned as-is
 * - Named keys (ArrowUp, Enter, Tab, etc.): mapped to standard ANSI sequences
 * - Function keys (F1-F12): mapped to VT220/xterm sequences
 * - Ctrl+letter: ASCII control codes 1-26
 * - Ctrl+Enter: newline (\n)
 * - Alt+key: ESC prefix + key
 */
export function keyToAnsi(key: KeyDescriptor | string): string {
  const desc = typeof key === "string" ? parseKey(key) : key
  const { key: mainKey, ctrl, alt, shift } = desc
  const hasSuperOrMeta = desc.super

  // Ctrl+letter -> control code (ASCII 1-26)
  if (ctrl && mainKey.length === 1) {
    const code = mainKey.toLowerCase().charCodeAt(0) - 96
    if (code >= 1 && code <= 26) return String.fromCharCode(code)
  }

  // Ctrl+Enter -> \n (legacy terminal convention: \r = Enter, \n = Ctrl+Enter/Ctrl+J)
  if (ctrl && mainKey === "Enter") {
    return "\n"
  }

  // Alt (or Super/Meta) + single character -> ESC prefix
  if ((alt || hasSuperOrMeta) && mainKey.length === 1) {
    return `\x1b${mainKey}`
  }

  // Function keys
  const fkey = FKEY_MAP[mainKey]
  if (fkey !== undefined) {
    // With modifiers, use CSI sequences with modifier parameter
    if (ctrl || alt || shift || hasSuperOrMeta) {
      const mod = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (hasSuperOrMeta ? 8 : 0)
      // F1-F4 use SS3 format, convert to CSI for modified keys
      const fkeyNum = parseInt(mainKey.slice(1))
      if (fkeyNum <= 4) {
        // F1=11, F2=12, F3=13, F4=14 in CSI ~ format
        const csiNum = fkeyNum + 10
        return `\x1b[${csiNum};${mod}~`
      }
      // F5-F12 already use CSI ~ format: extract the number
      const match = fkey.match(/\x1b\[(\d+)~/)
      if (match) {
        return `\x1b[${match[1]};${mod}~`
      }
    }
    return fkey
  }

  // Named keys from KEY_MAP
  const mapped = KEY_MAP[mainKey]
  if (mapped !== undefined) {
    if (mapped === null) return "" // Pure modifier keys produce nothing

    // Arrow/navigation keys with modifiers use CSI 1;mod format
    if ((ctrl || alt || shift || hasSuperOrMeta) && mapped.startsWith("\x1b[")) {
      const mod = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (hasSuperOrMeta ? 8 : 0)
      // CSI letter format (e.g., \x1b[A) -> CSI 1;mod letter
      const letterMatch = mapped.match(/\x1b\[([A-H])$/)
      if (letterMatch) {
        return `\x1b[1;${mod}${letterMatch[1]}`
      }
      // CSI num ~ format (e.g., \x1b[5~) -> CSI num;mod ~
      const tildeMatch = mapped.match(/\x1b\[(\d+)~$/)
      if (tildeMatch) {
        return `\x1b[${tildeMatch[1]};${mod}~`
      }
    }

    // Shift+Tab -> reverse tab (CSI Z)
    if (shift && mainKey === "Tab") {
      return "\x1b[Z"
    }

    return mapped
  }

  // Single character without modifiers
  if (mainKey.length === 1) {
    // Shift+letter -> uppercase (passthrough for terminals)
    if (shift && mainKey.match(/[a-z]/)) {
      return mainKey.toUpperCase()
    }
    return mainKey
  }

  // Unknown key: return as-is
  return mainKey
}
