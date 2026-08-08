/**
 * ttyrec → `Recording` codec — **import-only**.
 *
 * ttyrec is the terminal-recording format used by ttyrec(1) / ttyplay(1) (and
 * still emitted by some game/roguelike session recorders). Unlike asciicast's
 * JSON-lines text, ttyrec is a flat, header-less sequence of binary chunks —
 * each chunk one write() of terminal *output*:
 *
 * ```
 * [sec: u32 LE][usec: u32 LE][len: u32 LE][payload: len bytes]
 * [sec: u32 LE][usec: u32 LE][len: u32 LE][payload: len bytes]
 * ...
 * ```
 *
 * `sec`/`usec` are an **absolute wall-clock** timestamp (seconds +
 * microseconds since the Unix epoch) — unlike asciicast's per-event
 * float-second offset from recording start. `len` is the payload's byte
 * count; the payload is raw terminal output bytes. ttyrec carries **no
 * input, no resize, and no terminal dimensions** — those concepts don't
 * exist in the format.
 *
 * {@link decodeTtyrec} is the only direction: classic ttyrec is a **legacy
 * archive format termless only reads**, never writes — there is no
 * `encodeTtyrec` here (compare {@link "../asciicast/recording-codec.ts"},
 * which is symmetric). Every chunk becomes an {@link IoEvent} with
 * `direction: "out"`. The absolute wall-clock timestamp is normalized to the
 * {@link Recording} model's integer-µs-from-start monotonic clock (the first
 * chunk becomes `0µs`) via {@link micros} — never a raw float. Because ttyrec
 * carries no terminal dimensions, the caller supplies `{ cols, rows }`
 * (default 80×24) for the Recording envelope; `durationMicros` is the last
 * chunk's normalized time.
 *
 * ## Corruption handling
 *
 * A malformed ttyrec file can fail in two importantly different shapes:
 *
 *  - A **truncated tail** — the file ends mid-header or mid-payload, exactly
 *    as a recorder killed mid-write would leave it — is *tolerated*: decoding
 *    stops cleanly and every chunk parsed so far is kept. This mirrors the
 *    truncation tolerance the `.rec` container applies to its JSONL tracks
 *    (mirroring the container codec's `parseJsonl` tolerance) — an interrupted write is
 *    not corruption.
 *  - A **corrupt chunk** — a declared payload length past any plausible
 *    chunk size, or a timestamp that runs backward from the previous chunk —
 *    is not a truncation and is never silently dropped: {@link decodeTtyrec}
 *    throws immediately with a precise message. Corruption is not a tear.
 */

import { type Recording, type IoEvent, type Micros, createRecording, micros } from "../recording.ts"

/** Byte size of one ttyrec chunk header: `sec` + `usec` + `len`, each a u32 LE. */
const HEADER_BYTES = 12

/**
 * Sanity ceiling, in bytes, for a single chunk's declared payload length.
 *
 * A real ttyrec chunk is at most a few tens of kilobytes (one write() of
 * terminal output); this ceiling is generous enough to never reject a real
 * chunk while still rejecting an overflowed/garbage length (e.g.
 * `0xffffffff`). Only consulted once a chunk's declared payload doesn't fit
 * in the remaining input — see {@link decodeTtyrec}.
 */
const MAX_PLAUSIBLE_PAYLOAD_BYTES = 64 * 1024 * 1024 // 64 MiB

/** Options for {@link decodeTtyrec}. */
export interface DecodeTtyrecOptions {
  /** Terminal columns for the Recording envelope. ttyrec carries no dimensions. Default: `80`. */
  cols?: number
  /** Terminal rows for the Recording envelope. ttyrec carries no dimensions. Default: `24`. */
  rows?: number
}

/**
 * Decode raw ttyrec bytes into a {@link Recording} carrying an `io` source
 * track. Every chunk is terminal output (`direction: "out"`) — ttyrec has no
 * input, resize, or dimension events, so the result carries no `commands` or
 * `frames` track: a decoded ttyrec is observed-truth only.
 *
 * @param bytes Raw ttyrec file contents.
 * @param options See {@link DecodeTtyrecOptions}.
 * @returns The decoded {@link Recording}.
 * @throws {Error} when a chunk is corrupt — an implausible payload length, or
 *   a timestamp that regresses before the previous chunk. A truncated final
 *   chunk (header or payload cut short) is tolerated instead of thrown — see
 *   the module docstring's corruption-handling section. Also throws (via
 *   {@link createRecording}) when zero chunks decode, since a Recording must
 *   carry at least one non-empty track.
 */
export function decodeTtyrec(bytes: Uint8Array, options: DecodeTtyrecOptions = {}): Recording {
  const cols = options.cols ?? 80
  const rows = options.rows ?? 24
  const decoder = new TextDecoder() // fatal: false (default) -- lossy-tolerant of invalid UTF-8
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const io: IoEvent[] = []
  let baselineMicros = 0
  let prevAbsMicros: number | undefined
  let offset = 0

  while (offset < bytes.length) {
    if (bytes.length - offset < HEADER_BYTES) break // truncated header at the tail -- tolerate, stop cleanly

    const sec = view.getUint32(offset, true)
    const usec = view.getUint32(offset + 4, true)
    const len = view.getUint32(offset + 8, true)
    const payloadStart = offset + HEADER_BYTES
    const payloadEnd = payloadStart + len

    if (payloadEnd > bytes.length) {
      if (len > MAX_PLAUSIBLE_PAYLOAD_BYTES) {
        throw new Error(
          `decodeTtyrec: corrupt chunk at byte offset ${offset} — declared payload length ${len} exceeds ` +
            `the plausible ceiling of ${MAX_PLAUSIBLE_PAYLOAD_BYTES} bytes (not a truncated tail)`,
        )
      }
      break // truncated payload at the tail -- tolerate, stop cleanly, keep chunks parsed so far
    }

    const absMicros = sec * 1_000_000 + usec
    if (prevAbsMicros !== undefined && absMicros < prevAbsMicros) {
      throw new Error(
        `decodeTtyrec: corrupt chunk at byte offset ${offset} — timestamp ${sec}s+${usec}µs runs backward ` +
          `from the previous chunk's timestamp`,
      )
    }
    if (io.length === 0) baselineMicros = absMicros

    const data = decoder.decode(bytes.subarray(payloadStart, payloadEnd))
    io.push({ at: micros(absMicros - baselineMicros), direction: "out", data })
    prevAbsMicros = absMicros
    offset = payloadEnd
  }

  const durationMicros: Micros = io.length > 0 ? io[io.length - 1]!.at : micros(0)
  return createRecording({ cols, rows, durationMicros, io })
}
