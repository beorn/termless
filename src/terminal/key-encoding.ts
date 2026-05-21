/**
 * Shared ANSI key encoding for terminal backends.
 *
 * All backends need to convert KeyDescriptor → Uint8Array for PTY input.
 * This module delegates to keyToAnsi() as the single source of truth for
 * ANSI key encoding, converting the string result to bytes.
 */

import type { KeyDescriptor } from "./types.ts"
import { keyToAnsi } from "./key-mapping.ts"

// Module-level TextEncoder for efficiency (avoids per-call allocation)
const encoder = new TextEncoder()

/**
 * Encode a KeyDescriptor to an ANSI byte sequence for PTY input.
 *
 * Delegates to keyToAnsi() for the actual encoding, then converts to bytes.
 * This is the canonical encoder — backends that don't have their own
 * protocol (e.g., kitty keyboard) should use this.
 */
export function encodeKeyToAnsi(key: KeyDescriptor): Uint8Array {
  const ansi = keyToAnsi(key)
  return encoder.encode(ansi)
}
