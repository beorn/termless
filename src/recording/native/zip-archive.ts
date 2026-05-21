/**
 * Minimal, dependency-free ZIP container — `pack` / `unpack` for the `.trec`
 * native recording format (see {@link "./native-trec.ts"}).
 *
 * A `.trec` recording is a **directory bundle** by default. `pack` zips that
 * directory into a single-file portable archive (like `.docx` / `.epub`);
 * `unpack` expands it back. The archive is a standard ZIP — readable by any
 * ZIP tool — but termless writes and reads it itself so the native format has
 * **zero runtime dependencies**.
 *
 * Implementation notes:
 *
 *  - Entries are stored with DEFLATE compression (method 8) via Node's
 *    `node:zlib` `deflateRawSync` — already a termless-supported dependency
 *    (every runtime termless targets ships `node:zlib`).
 *  - 32-bit fields only — no ZIP64. A recording bundle is well under 4 GiB
 *    (PNGs are small; `.jsonl` tracks are text). The directory layout is the
 *    answer for genuinely huge traces; the archive is the portable convenience.
 *  - CRC-32 is computed per entry (ZIP mandates it). A small precomputed table
 *    keeps it fast and dependency-free.
 *
 * This is intentionally a *codec*, not a general archiver: it round-trips a
 * `name → bytes` map, which is exactly what the `.trec` directory is.
 */

import { deflateRawSync, inflateRawSync } from "node:zlib"

// =============================================================================
// CRC-32 — ZIP mandates a per-entry checksum.
// =============================================================================

/** Precomputed CRC-32 table (IEEE 802.3 polynomial, reflected). */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

/** Compute the CRC-32 of a byte buffer. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// =============================================================================
// Archive entry
// =============================================================================

/** One file inside a ZIP archive — a path (forward-slash separated) + bytes. */
export interface ZipEntry {
  /** Path within the archive, forward-slash separated (e.g. `frames/00001.png`). */
  path: string
  /** The file's raw bytes. */
  bytes: Uint8Array
}

// =============================================================================
// Writing
// =============================================================================

/** A DOS date/time pair encoded for a ZIP entry — fixed epoch for reproducibility. */
const DOS_DATE = 0x0021 // 1980-01-01
const DOS_TIME = 0x0000 // 00:00:00

/**
 * Build a ZIP archive from a set of entries.
 *
 * Entries are written in the order given. The archive uses DEFLATE for every
 * entry, a fixed 1980-01-01 timestamp (so the same content produces the same
 * bytes — reproducible archives), and only 32-bit fields.
 *
 * @param entries The files to archive.
 * @returns The complete ZIP archive bytes.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path)
    const crc = crc32(entry.bytes)
    const compressed = deflateRawSync(entry.bytes)

    // Local file header (30 bytes + name).
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // signature
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0, true) // flags
    lv.setUint16(8, 8, true) // method: deflate
    lv.setUint16(10, DOS_TIME, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, compressed.length, true)
    lv.setUint32(22, entry.bytes.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // extra length
    local.set(nameBytes, 30)
    localChunks.push(local, compressed)

    // Central directory header (46 bytes + name).
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // signature
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0, true) // flags
    cv.setUint16(10, 8, true) // method: deflate
    cv.setUint16(12, DOS_TIME, true)
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, compressed.length, true)
    cv.setUint32(24, entry.bytes.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // extra length
    cv.setUint16(32, 0, true) // comment length
    cv.setUint16(34, 0, true) // disk number
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, offset, true) // local header offset
    central.set(nameBytes, 46)
    centralChunks.push(central)

    offset += local.length + compressed.length
  }

  const centralStart = offset
  let centralSize = 0
  for (const c of centralChunks) centralSize += c.length

  // End-of-central-directory record (22 bytes, no comment).
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // signature
  ev.setUint16(4, 0, true) // disk number
  ev.setUint16(6, 0, true) // central dir start disk
  ev.setUint16(8, entries.length, true) // entries on this disk
  ev.setUint16(10, entries.length, true) // total entries
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, centralStart, true)
  ev.setUint16(20, 0, true) // comment length

  return concat([...localChunks, ...centralChunks, eocd])
}

/** Concatenate byte buffers into one. */
function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

// =============================================================================
// Reading
// =============================================================================

/**
 * Parse a ZIP archive into its entries.
 *
 * Reads via the end-of-central-directory record + central directory — the
 * canonical ZIP read path — so the entry order and metadata match what
 * {@link buildZip} wrote. Only the stored (0) and DEFLATE (8) methods are
 * supported; an unknown method throws.
 *
 * @param archive The ZIP archive bytes.
 * @returns The archived entries, in central-directory order.
 * @throws {Error} when the archive has no EOCD record or uses an unsupported
 *   compression method.
 */
export function parseZip(archive: Uint8Array): ZipEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const decoder = new TextDecoder()

  // Find the end-of-central-directory record by scanning backwards for its
  // signature (it is within the last 22 + 65535 bytes; no comment here).
  let eocd = -1
  for (let i = archive.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) {
    throw new Error("parseZip: not a ZIP archive (no end-of-central-directory record)")
  }

  const totalEntries = view.getUint16(eocd + 10, true)
  let pointer = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []

  for (let n = 0; n < totalEntries; n++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) {
      throw new Error("parseZip: malformed central directory")
    }
    const method = view.getUint16(pointer + 10, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const uncompressedSize = view.getUint32(pointer + 24, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localOffset = view.getUint32(pointer + 42, true)
    const name = decoder.decode(archive.subarray(pointer + 46, pointer + 46 + nameLength))

    // Resolve the data from the local header at `localOffset`.
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    const raw = archive.subarray(dataStart, dataEnd)

    let bytes: Uint8Array
    if (method === 0) {
      bytes = raw.slice()
    } else if (method === 8) {
      bytes = new Uint8Array(inflateRawSync(raw))
    } else {
      throw new Error(`parseZip: unsupported compression method ${method} for entry "${name}"`)
    }
    if (bytes.length !== uncompressedSize) {
      throw new Error(`parseZip: size mismatch for entry "${name}"`)
    }

    entries.push({ path: name, bytes })
    pointer += 46 + nameLength + extraLength + commentLength
  }

  return entries
}
