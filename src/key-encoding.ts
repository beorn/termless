/**
 * Shared ANSI key encoding for terminal backends.
 *
 * All backends need to convert KeyDescriptor → Uint8Array for PTY input.
 * This module provides that encoding so backends don't duplicate it.
 *
 * Note: This is the backend-level encoder (KeyDescriptor → Uint8Array).
 * For the higher-level string-based encoder, see key-mapping.ts (keyToAnsi).
 */

import type { KeyDescriptor } from "./types.ts"

// Module-level TextEncoder for efficiency (avoids per-call allocation)
const encoder = new TextEncoder()

/** Standard ANSI escape sequences for special keys (no modifiers) */
export const SPECIAL_KEYS: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
  Enter: "\r",
  Tab: "\t",
  Backspace: "\x7f",
  Escape: "\x1b",
  Space: " ",
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

/** CSI-style arrow/nav keys that support modifier parameters */
export const CSI_KEYS: Record<string, { code: string; suffix: string }> = {
  ArrowUp: { code: "1", suffix: "A" },
  ArrowDown: { code: "1", suffix: "B" },
  ArrowRight: { code: "1", suffix: "C" },
  ArrowLeft: { code: "1", suffix: "D" },
  Home: { code: "1", suffix: "H" },
  End: { code: "1", suffix: "F" },
  PageUp: { code: "5", suffix: "~" },
  PageDown: { code: "6", suffix: "~" },
  Insert: { code: "2", suffix: "~" },
  Delete: { code: "3", suffix: "~" },
  F1: { code: "1", suffix: "P" },
  F2: { code: "1", suffix: "Q" },
  F3: { code: "1", suffix: "R" },
  F4: { code: "1", suffix: "S" },
  F5: { code: "15", suffix: "~" },
  F6: { code: "17", suffix: "~" },
  F7: { code: "18", suffix: "~" },
  F8: { code: "19", suffix: "~" },
  F9: { code: "20", suffix: "~" },
  F10: { code: "21", suffix: "~" },
  F11: { code: "23", suffix: "~" },
  F12: { code: "24", suffix: "~" },
}

/**
 * Compute the xterm modifier parameter (1-based bitmask):
 *   bit 0 = Shift, bit 1 = Alt, bit 2 = Ctrl
 * The parameter value is (bits + 1).
 */
function modifierParam(key: KeyDescriptor): number {
  let bits = 0
  if (key.shift) bits |= 1
  if (key.alt) bits |= 2
  if (key.ctrl) bits |= 4
  return bits + 1
}

/** Encode a KeyDescriptor to an ANSI byte sequence for PTY input */
export function encodeKeyToAnsi(key: KeyDescriptor): Uint8Array {
  const hasModifier = key.shift || key.alt || key.ctrl

  // Ctrl+letter -> control code (ASCII 1-26)
  if (key.ctrl && !key.alt && !key.shift && key.key.length === 1) {
    const code = key.key.toLowerCase().charCodeAt(0) - 96
    if (code >= 1 && code <= 26) {
      return new Uint8Array([code])
    }
  }

  // Alt+letter -> ESC prefix
  if (key.alt && !key.ctrl && !key.shift && key.key.length === 1) {
    return encoder.encode(`\x1b${key.key}`)
  }

  // Special keys with modifiers -> CSI parameter encoding
  if (hasModifier && key.key in CSI_KEYS) {
    const csi = CSI_KEYS[key.key]!
    const mod = modifierParam(key)
    return encoder.encode(`\x1b[${csi.code};${mod}${csi.suffix}`)
  }

  // Special keys without modifiers
  if (key.key in SPECIAL_KEYS) {
    return encoder.encode(SPECIAL_KEYS[key.key]!)
  }

  // Regular character
  return encoder.encode(key.key)
}
