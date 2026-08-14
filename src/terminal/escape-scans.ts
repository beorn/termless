const WINDOW_OP_RE = /\x1b\[(14|18)t|\x1b\[\?996n/g
const MOUSE_DECSET_RE = /\x1b\[\?([\d;]+)([hl])/g

export type WindowOpQuery = "14t" | "18t" | "?996n"

export function scanWindowOpQueries(data: string, onQuery: (query: WindowOpQuery) => void): void {
  if (!data.includes("\x1b[")) return
  WINDOW_OP_RE.lastIndex = 0
  for (let match = WINDOW_OP_RE.exec(data); match !== null; match = WINDOW_OP_RE.exec(data)) {
    if (match[1] === "14") onQuery("14t")
    else if (match[1] === "18") onQuery("18t")
    else onQuery("?996n")
  }
}

export function scanMouseDecset(data: string, onToggle: (param: "1000" | "1002" | "1003", on: boolean) => void): void {
  if (!data.includes("\x1b[?")) return
  MOUSE_DECSET_RE.lastIndex = 0
  for (let match = MOUSE_DECSET_RE.exec(data); match !== null; match = MOUSE_DECSET_RE.exec(data)) {
    const on = match[2] === "h"
    for (const param of match[1]!.split(";")) {
      if (param === "1000" || param === "1002" || param === "1003") {
        onToggle(param, on)
      }
    }
  }
}

export interface MouseDecsetState {
  m1000: boolean
  m1002: boolean
  m1003: boolean
}

export function scanMouseDecsetTracking(
  data: string,
  trackMouse: boolean,
  mouseModes: MouseDecsetState,
  onChange: () => void,
): void {
  if (!trackMouse || !data.includes("\x1b[?")) return
  let changed = false
  scanMouseDecset(data, (param, on) => {
    if (param === "1000") ((mouseModes.m1000 = on), (changed = true))
    else if (param === "1002") ((mouseModes.m1002 = on), (changed = true))
    else if (param === "1003") ((mouseModes.m1003 = on), (changed = true))
  })
  if (changed) onChange()
}

const ESC = 0x1b
const BEL = 0x07
const OSC = 0x5d
const OSC_8 = 0x38
const SEMICOLON = 0x3b
const ST_FINAL = 0x5c
const DEFAULT_MAX_OSC8_URI_BYTES = 64 * 1024
const MAX_OSC8_PARAMETER_BYTES = 1024

export type Osc8DropReason =
  | "missing-command-separator"
  | "missing-uri-separator"
  | "params-too-long"
  | "uri-too-long"
  | "interleaved-control"
  | "unterminated"

export interface Osc8PassthroughGate {
  push(data: Uint8Array): void
  end(): void
}

export interface Osc8PassthroughGateOptions {
  /** Receives byte-exact output after complete OSC 8 sequences validate. */
  onData(data: Uint8Array): void
  /** Receives one reason for each malformed OSC 8 sequence. */
  onDrop(reason: Osc8DropReason): void
  /** Maximum URI payload size in bytes. Defaults to a generous, bounded 64 KiB. */
  maxUriBytes?: number
}

/**
 * Validate OSC 8 boundaries on an untrusted raw terminal passthrough.
 *
 * This is deliberately not a semantic terminal parser. It recognizes only the
 * OSC 8 envelope owned by the raw PTY fork, buffers candidates across chunks,
 * and otherwise preserves every byte exactly. Hosted terminal output remains
 * emulator-owned and does not pass through this gate.
 */
export function createOsc8PassthroughGate(options: Osc8PassthroughGateOptions): Osc8PassthroughGate {
  const maxUriBytes = options.maxUriBytes ?? DEFAULT_MAX_OSC8_URI_BYTES
  if (!Number.isSafeInteger(maxUriBytes) || maxUriBytes < 0) {
    throw new RangeError("maxUriBytes must be a non-negative safe integer")
  }

  type Mode = "idle" | "prefix" | "params" | "uri" | "dropping"
  let mode: Mode = "idle"
  let pending: number[] = []
  let paramsBytes = 0
  let uriBytes = 0
  let stringEsc = false
  let ended = false

  function reset(): void {
    mode = "idle"
    pending = []
    paramsBytes = 0
    uriBytes = 0
    stringEsc = false
  }

  function startDrop(reason: Osc8DropReason): void {
    options.onDrop(reason)
    mode = "dropping"
    pending = []
    stringEsc = false
  }

  function appendPending(output: number[]): void {
    for (const byte of pending) output.push(byte)
    pending = []
  }

  function consumeDropping(byte: number): void {
    if (stringEsc) {
      if (byte === ST_FINAL) {
        reset()
        return
      }
      stringEsc = byte === ESC
      return
    }
    if (byte === BEL) {
      reset()
    } else if (byte === ESC) {
      stringEsc = true
    }
  }

  function terminate(output: number[], terminator: number[]): void {
    if (mode === "uri") {
      pending.push(...terminator)
      appendPending(output)
    } else if (mode === "params") {
      options.onDrop("missing-uri-separator")
    }
    reset()
  }

  function consumeStringByte(byte: number, output: number[]): void {
    if (mode === "dropping") {
      consumeDropping(byte)
      return
    }

    if (stringEsc) {
      stringEsc = false
      if (byte === ST_FINAL) {
        terminate(output, [ST_FINAL])
        return
      }
      startDrop("interleaved-control")
      consumeDropping(byte)
      return
    }

    if (byte === BEL) {
      terminate(output, [BEL])
      return
    }
    if (byte === ESC) {
      pending.push(byte)
      stringEsc = true
      return
    }
    if (byte < 0x20 || byte === 0x7f) {
      startDrop("interleaved-control")
      return
    }

    pending.push(byte)
    if (mode === "params") {
      if (byte === SEMICOLON) {
        mode = "uri"
        return
      }
      paramsBytes++
      if (paramsBytes > MAX_OSC8_PARAMETER_BYTES) startDrop("params-too-long")
      return
    }

    uriBytes++
    if (uriBytes > maxUriBytes) startDrop("uri-too-long")
  }

  function consumeIdle(byte: number, output: number[]): void {
    if (byte === ESC) {
      mode = "prefix"
      pending = [byte]
    } else {
      output.push(byte)
    }
  }

  function consumePrefix(byte: number, output: number[]): void {
    const expected = pending.length === 1 ? OSC : pending.length === 2 ? OSC_8 : SEMICOLON
    if (byte === expected) {
      pending.push(byte)
      if (pending.length === 4) mode = "params"
      return
    }

    // A longer numeric OSC command (80, 81, ...) is unrelated to OSC 8.
    if (pending.length === 3 && byte >= 0x30 && byte <= 0x39) {
      appendPending(output)
      reset()
      consumeIdle(byte, output)
      return
    }

    // Before the command byte matches, this is simply some other escape.
    if (pending.length < 3) {
      appendPending(output)
      reset()
      consumeIdle(byte, output)
      return
    }

    // ESC ] 8 committed to OSC 8. Anything except ';' is malformed and must
    // be consumed through its terminator instead of leaking payload as text.
    startDrop("missing-command-separator")
    consumeDropping(byte)
  }

  return {
    push(data): void {
      if (ended) throw new Error("OSC 8 passthrough gate is already ended")
      const output: number[] = []
      for (const byte of data) {
        if (mode === "idle") consumeIdle(byte, output)
        else if (mode === "prefix") consumePrefix(byte, output)
        else consumeStringByte(byte, output)
      }
      if (output.length > 0) options.onData(Uint8Array.from(output))
    },

    end(): void {
      if (ended) return
      ended = true
      if (mode === "params" || mode === "uri" || (mode === "prefix" && pending.length >= 3)) {
        options.onDrop("unterminated")
      }
      reset()
    },
  }
}
