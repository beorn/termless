/**
 * Regenerates `07-generated-100.cast` — the 100+ event golden fixture for the
 * asciicast golden-roundtrip suite (../golden-roundtrip.test.ts).
 *
 * Pure formulaic generation, no RNG: every timestamp, type and payload is a
 * deterministic function of the event index, so re-running this script
 * reproduces the committed file byte-for-byte. That determinism is the whole
 * point — a golden fixture that can't be regenerated identically isn't one.
 *
 * Regenerate:
 *   bun run tests/asciicast/fixtures/generate-fixture-07.ts
 *
 * Then confirm nothing moved:
 *   git diff --stat tests/asciicast/fixtures/07-generated-100.cast
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const EVENT_COUNT = 120
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "07-generated-100.cast")

const header = { version: 2, width: 100, height: 30, title: "generated 100+ event corpus" }
const lines: string[] = [JSON.stringify(header)]

let time = 0
for (let i = 0; i < EVENT_COUNT; i++) {
  // Mostly output, an input every 7th event, a marker every 11th — a
  // realistic-ish output-heavy stream with occasional input and chapter
  // markers, not a uniform o/o/o/o pattern.
  const type = i % 11 === 10 ? "m" : i % 7 === 6 ? "i" : "o"
  const data = type === "m" ? `marker-${i}` : type === "i" ? `cmd${i}\r` : `line ${i}: the quick brown fox\r\n`
  // Round the accumulated float to µs precision at emission time only — real
  // asciinema timestamps look like this; leaving the raw accumulator in would
  // print binary-float noise (0.15000000000000002) instead of 0.15.
  const emittedTime = Math.round(time * 1_000_000) / 1_000_000
  lines.push(JSON.stringify([emittedTime, type, data]))
  // Mostly small, uniform gaps; a longer gap every 23rd event so the fixture
  // also carries timing variety (small deltas plus an occasional pause).
  time += i % 23 === 22 ? 1.5 : 0.05
}

const text = lines.join("\n") + "\n"
writeFileSync(OUT_PATH, text)
console.log(`wrote ${EVENT_COUNT} events (${text.length} bytes) to ${OUT_PATH}`)
