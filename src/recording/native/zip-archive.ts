/**
 * Minimal, dependency-free ZIP container — the sealed (`.ttyz`) encoding of
 * the `.tty`/`.ttyz` recording format (see {@link "./tty-format.ts"}).
 *
 * A sealed recording is a **single-file container**: every bundle member
 * becomes an archive entry. The archive is a standard ZIP — readable by any
 * ZIP tool — but termless writes and reads it itself so the format has
 * **zero runtime dependencies**.
 *
 * Implementation notes:
 *
 *  - **Per-entry compression method**: DEFLATE (8) by default via Node's
 *    `node:zlib`; STORED (0) for already-compressed members (rasters). The
 *    caller picks per entry — see `ZipEntry.method`.
 *  - **ZIP64-capable**: entry counts beyond the 16-bit EOCD field, and sizes
 *    or offsets beyond 32 bits, write ZIP64 records (per-entry extra fields,
 *    the ZIP64 end-of-central-directory record + locator). Small archives
 *    stay plain ZIP, byte-compatible with every tool.
 *  - CRC-32 is computed per entry (ZIP mandates it). A small precomputed table
 *    keeps it fast and dependency-free.
 *  - Fixed 1980-01-01 timestamps — the same content always produces the same
 *    bytes (reproducible archives).
 *
 * This is intentionally a *codec*, not a general archiver: it round-trips a
 * `name → bytes` set, which is exactly what a recording bundle is.
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
  /**
   * Compression method: `8` DEFLATE (default), `0` STORED — for members that
   * are already compressed (rasters), where deflating again wastes time and
   * bytes.
   */
  method?: 0 | 8
}

// =============================================================================
// Writing
// =============================================================================

/** A DOS date/time pair encoded for a ZIP entry — fixed epoch for reproducibility. */
const DOS_DATE = 0x0021 // 1980-01-01
const DOS_TIME = 0x0000 // 00:00:00

const U16_MAX = 0xffff
const U32_MAX = 0xffffffff

/**
 * Build a ZIP archive from a set of entries.
 *
 * Entries are written in the order given. Per-entry method (DEFLATE default,
 * STORED on request), fixed 1980-01-01 timestamps, and ZIP64 records exactly
 * where 16/32-bit fields overflow — never otherwise, so small archives stay
 * plain ZIP.
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
    const method = entry.method ?? 8
    const crc = crc32(entry.bytes)
    const compressed = method === 0 ? entry.bytes : deflateRawSync(entry.bytes)
    const needsZip64 = entry.bytes.length > U32_MAX || compressed.length > U32_MAX || offset > U32_MAX

    // ZIP64 extra field (0x0001): uncompressed, compressed, local offset — in
    // that order, only when this entry overflows a 32-bit field.
    const extra = needsZip64 ? new Uint8Array(4 + 24) : new Uint8Array(0)
    if (needsZip64) {
      const xv = new DataView(extra.buffer)
      xv.setUint16(0, 0x0001, true)
      xv.setUint16(2, 24, true)
      xv.setBigUint64(4, BigInt(entry.bytes.length), true)
      xv.setBigUint64(12, BigInt(compressed.length), true)
      xv.setBigUint64(20, BigInt(offset), true)
    }
    const sizeField = (n: number) => (needsZip64 ? U32_MAX : n)
    const offsetField = needsZip64 ? U32_MAX : offset

    // Local file header (30 bytes + name + extra).
    const local = new Uint8Array(30 + nameBytes.length + extra.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // signature
    lv.setUint16(4, needsZip64 ? 45 : 20, true) // version needed
    lv.setUint16(6, 0, true) // flags
    lv.setUint16(8, method, true)
    lv.setUint16(10, DOS_TIME, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, sizeField(compressed.length), true)
    lv.setUint32(22, sizeField(entry.bytes.length), true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, extra.length, true)
    local.set(nameBytes, 30)
    local.set(extra, 30 + nameBytes.length)
    localChunks.push(local, compressed)

    // Central directory header (46 bytes + name + extra).
    const central = new Uint8Array(46 + nameBytes.length + extra.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // signature
    cv.setUint16(4, needsZip64 ? 45 : 20, true) // version made by
    cv.setUint16(6, needsZip64 ? 45 : 20, true) // version needed
    cv.setUint16(8, 0, true) // flags
    cv.setUint16(10, method, true)
    cv.setUint16(12, DOS_TIME, true)
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, sizeField(compressed.length), true)
    cv.setUint32(24, sizeField(entry.bytes.length), true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, extra.length, true)
    cv.setUint16(32, 0, true) // comment length
    cv.setUint16(34, 0, true) // disk number
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, offsetField, true) // local header offset
    central.set(nameBytes, 46)
    central.set(extra, 46 + nameBytes.length)
    centralChunks.push(central)

    offset += local.length + compressed.length
  }

  const centralStart = offset
  let centralSize = 0
  for (const c of centralChunks) centralSize += c.length

  const needsZip64Eocd = entries.length > U16_MAX || centralStart > U32_MAX || centralSize > U32_MAX
  const tailChunks: Uint8Array[] = []

  if (needsZip64Eocd) {
    // ZIP64 end-of-central-directory record (56 bytes, no extensible data).
    const z64 = new Uint8Array(56)
    const zv = new DataView(z64.buffer)
    zv.setUint32(0, 0x06064b50, true) // signature
    zv.setBigUint64(4, BigInt(44), true) // size of remainder of record
    zv.setUint16(12, 45, true) // version made by
    zv.setUint16(14, 45, true) // version needed
    zv.setUint32(16, 0, true) // this disk
    zv.setUint32(20, 0, true) // central dir start disk
    zv.setBigUint64(24, BigInt(entries.length), true) // entries on this disk
    zv.setBigUint64(32, BigInt(entries.length), true) // total entries
    zv.setBigUint64(40, BigInt(centralSize), true)
    zv.setBigUint64(48, BigInt(centralStart), true)
    tailChunks.push(z64)

    // ZIP64 end-of-central-directory locator (20 bytes).
    const locator = new Uint8Array(20)
    const ov = new DataView(locator.buffer)
    ov.setUint32(0, 0x07064b50, true) // signature
    ov.setUint32(4, 0, true) // disk with the ZIP64 EOCD
    ov.setBigUint64(8, BigInt(centralStart + centralSize), true) // its offset
    ov.setUint32(16, 1, true) // total disks
    tailChunks.push(locator)
  }

  // Classic end-of-central-directory record (22 bytes, no comment) — with
  // 0xFFFF/0xFFFFFFFF sentinels pointing at the ZIP64 record when present.
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // signature
  ev.setUint16(4, 0, true) // disk number
  ev.setUint16(6, 0, true) // central dir start disk
  ev.setUint16(8, Math.min(entries.length, U16_MAX), true)
  ev.setUint16(10, Math.min(entries.length, U16_MAX), true)
  ev.setUint32(12, Math.min(centralSize, U32_MAX), true)
  ev.setUint32(16, Math.min(centralStart, U32_MAX), true)
  ev.setUint16(20, 0, true) // comment length
  tailChunks.push(eocd)

  return concat([...localChunks, ...centralChunks, ...tailChunks])
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
 * canonical ZIP read path — following the ZIP64 locator when the classic
 * record carries overflow sentinels. Only the STORED (0) and DEFLATE (8)
 * methods are supported; an unknown method throws.
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

  let totalEntries: number = view.getUint16(eocd + 10, true)
  let pointer: number = view.getUint32(eocd + 16, true)

  // ZIP64: overflow sentinels route through the locator to the ZIP64 EOCD.
  if (totalEntries === U16_MAX || pointer === U32_MAX) {
    const locatorAt = eocd - 20
    if (locatorAt < 0 || view.getUint32(locatorAt, true) !== 0x07064b50) {
      throw new Error("parseZip: EOCD carries ZIP64 sentinels but no ZIP64 locator precedes it")
    }
    const z64At = Number(view.getBigUint64(locatorAt + 8, true))
    if (view.getUint32(z64At, true) !== 0x06064b50) {
      throw new Error("parseZip: ZIP64 locator points at no ZIP64 end-of-central-directory record")
    }
    totalEntries = Number(view.getBigUint64(z64At + 32, true))
    pointer = Number(view.getBigUint64(z64At + 48, true))
  }

  const entries: ZipEntry[] = []

  for (let n = 0; n < totalEntries; n++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) {
      throw new Error("parseZip: malformed central directory")
    }
    const method = view.getUint16(pointer + 10, true)
    let compressedSize: number = view.getUint32(pointer + 20, true)
    let uncompressedSize: number = view.getUint32(pointer + 24, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    let localOffset: number = view.getUint32(pointer + 42, true)
    const name = decoder.decode(archive.subarray(pointer + 46, pointer + 46 + nameLength))

    // ZIP64 extra field (0x0001): fields present in fixed order for exactly
    // the 32-bit values that carry the overflow sentinel.
    if (compressedSize === U32_MAX || uncompressedSize === U32_MAX || localOffset === U32_MAX) {
      let at = pointer + 46 + nameLength
      const end = at + extraLength
      let found = false
      while (at + 4 <= end) {
        const id = view.getUint16(at, true)
        const size = view.getUint16(at + 2, true)
        if (id === 0x0001) {
          let f = at + 4
          if (uncompressedSize === U32_MAX) {
            uncompressedSize = Number(view.getBigUint64(f, true))
            f += 8
          }
          if (compressedSize === U32_MAX) {
            compressedSize = Number(view.getBigUint64(f, true))
            f += 8
          }
          if (localOffset === U32_MAX) {
            localOffset = Number(view.getBigUint64(f, true))
          }
          found = true
          break
        }
        at += 4 + size
      }
      if (!found) {
        throw new Error(`parseZip: entry "${name}" carries ZIP64 sentinels but no ZIP64 extra field`)
      }
    }

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

    entries.push({ path: name, bytes, ...(method === 0 ? { method: 0 as const } : {}) })
    pointer += 46 + nameLength + extraLength + commentLength
  }

  return entries
}
