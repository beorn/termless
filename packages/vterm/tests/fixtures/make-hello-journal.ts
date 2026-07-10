/**
 * Generator for hello-journal.json — the bundled hand-authored journal
 * fixture for journal-session-differential.test.ts. Run once to (re)create
 * the fixture; the JSON is committed so the test needs no generation step:
 *
 *   bun packages/vterm/tests/fixtures/make-hello-journal.ts
 *
 * Content deliberately stays OFF the known divergence set (no ZWJ clusters,
 * no OSC 8, no DECSCUSR/DECTCEM, no fancy underline) so the fixture pins
 * ZERO divergence between the guests.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64")

const events = [
  { kind: "lifecycle", offset: 0, at: 1000, state: "awake" },
  { kind: "output", offset: 1, at: 1010, bytesB64: b64("journal parity\r\n") },
  {
    kind: "output",
    offset: 2,
    at: 1020,
    bytesB64: b64("\x1b[1mB\x1b[0m\x1b[3mI\x1b[0m\x1b[4mU\x1b[0m\x1b[7mR\x1b[0m\r\n"),
  },
  {
    kind: "output",
    offset: 3,
    at: 1030,
    bytesB64: b64("\x1b[31;42mX\x1b[0m \x1b[38;5;208m\x1b[48;5;27mZ\x1b[0m \x1b[38;2;10;20;30mT\x1b[0m\r\n"),
  },
  // A client keystroke — replay must NOT feed this to the write side.
  { kind: "input", offset: 4, at: 1040, bytesB64: b64("ls -la\r") },
  { kind: "resize", offset: 5, at: 1050, size: { cols: 60, rows: 12 } },
  { kind: "output", offset: 6, at: 1060, bytesB64: b64("after resize\r\nabc\rQ\r\n") },
  { kind: "output", offset: 7, at: 1070, bytesB64: b64("\x1b[12;1H\x1b[96mend\x1b[0m") },
  { kind: "lifecycle", offset: 8, at: 1080, state: "exited" },
]

const fixture = { size: { cols: 40, rows: 10 }, events }
const target = join(import.meta.dirname, "hello-journal.json")
writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`wrote ${target} (${events.length} events)`)
