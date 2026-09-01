/**
 * Conformance fixtures for the io primitives.
 *
 * These are deliberately reusable rather than test-local: the same Event
 * stream, the same fake Emulator and the same "members are views of events()"
 * check run against the real `Session` and `Emulator` implementations in phase
 * A2, so a fixture that only satisfies a mock would be caught there.
 */

import { expect } from "vitest"
import type {
  ControlEvent,
  Emulator,
  Event,
  Exit,
  InputEvent,
  Micros,
  Modes,
  OutputEvent,
  Session,
  Size,
} from "../../src/io/index.ts"
import { MODES, micros } from "../../src/io/index.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Encode a string as an Event payload. */
export function bytes(text: string): Uint8Array {
  return encoder.encode(text)
}

/** Decode an Event payload back to a string. */
export function text(data: Uint8Array): string {
  return decoder.decode(data)
}

/** The geometry every fixture uses. */
export const FIXTURE_SIZE: Size = { cols: 80, rows: 24 }

/**
 * The conformance stream — one small session touching every Event type, in
 * causal order.
 *
 * A session that starts at 80×24, prints, takes a keystroke, marks a prompt
 * boundary, is signalled, and exits cleanly. Every `type` in the union appears
 * at least once, so a consumer that ignores one is visible.
 */
export function conformanceEvents(): Event[] {
  return [
    { at: micros(0), type: "control", control: "resize", size: { ...FIXTURE_SIZE } },
    { at: micros(1_000), type: "output", data: bytes("hello") },
    { at: micros(2_000), type: "input", data: bytes("ls\r") },
    { at: micros(3_000), type: "mark", name: "prompt" },
    { at: micros(4_000), type: "output", data: bytes(" world") },
    { at: micros(5_000), type: "control", control: "signal", signal: "SIGWINCH" },
    { at: micros(6_000), type: "input", data: bytes("q") },
    { at: micros(7_000), type: "exit", code: 0, signal: null },
  ]
}

/** An emulator fake that records what it was fed and concatenates output bytes. */
export interface FakeEmulator extends Emulator {
  /** Every Event handed to `apply`, in order. */
  readonly applied: readonly Event[]
}

/**
 * A minimal {@link Emulator}: it appends `output` payloads to its text, follows
 * `resize` and `mode` control events, and records everything it was given.
 *
 * It ignores `input` for the same reason a real emulator does — input goes to
 * the program, and the program's echo comes back as `output`.
 */
export function fakeEmulator(size: Size = FIXTURE_SIZE): FakeEmulator {
  const applied: Event[] = []
  const modes = Object.fromEntries(MODES.map((m) => [m, false])) as Record<string, boolean>
  let current: Size = { ...size }
  let buffer = ""

  return {
    applied,
    apply(e: Event): void {
      applied.push(e)
      if (e.type === "output") buffer += text(e.data)
      if (e.type === "control" && e.control === "resize") current = { ...e.size }
      if (e.type === "control" && e.control === "mode") modes[e.mode] = e.enabled
    },
    getText: () => buffer,
    getCell: (row, col) => ({
      char: buffer[row * current.cols + col] ?? " ",
      fg: null,
      bg: null,
      bold: false,
      dim: false,
      italic: false,
      underline: "none",
      underlineColor: null,
      strikethrough: false,
      inverse: false,
      blink: false,
      hidden: false,
      wide: false,
      continuation: false,
      hyperlink: null,
    }),
    get cursor() {
      return { col: 0, row: 0, visible: true, style: "block" as const, x: 0, y: 0 }
    },
    get modes(): Modes {
      return { ...modes } as Modes
    },
    get size() {
      return { ...current }
    },
  }
}

/**
 * A {@link Session} backed by a fixed Event list.
 *
 * `events()` walks the list; `output`, `input` and `control` filter that same
 * list, which is what makes them *views* rather than parallel truths. Writes
 * through `input`/`control` append to the list so the members stay consistent
 * with the primitive.
 */
export function fakeSession(events: Event[] = conformanceEvents()): Session {
  const rows = [...events]
  let clock = rows.length > 0 ? rows[rows.length - 1]!.at + 1 : 0

  const nextAt = (): Micros => micros(clock++)

  async function* walk(): AsyncGenerator<Event> {
    for (const e of rows) yield e
  }

  function view<T extends Event>(match: (e: Event) => e is T): AsyncIterable<T> {
    return {
      async *[Symbol.asyncIterator]() {
        for await (const e of walk()) if (match(e)) yield e
      },
    }
  }

  const isOutput = (e: Event): e is OutputEvent => e.type === "output"
  const isInput = (e: Event): e is InputEvent => e.type === "input"
  const isControl = (e: Event): e is ControlEvent => e.type === "control"

  const exitRow = rows.find((e) => e.type === "exit")
  const exit: Exit =
    exitRow?.type === "exit" ? { code: exitRow.code, signal: exitRow.signal } : { code: null, signal: null }

  const size = rows.reduce<Size>((acc, e) => (e.type === "control" && e.control === "resize" ? { ...e.size } : acc), {
    ...FIXTURE_SIZE,
  })

  return {
    output: view(isOutput),
    input: Object.assign(view(isInput), {
      write(data: Uint8Array | string): void {
        rows.push({ at: nextAt(), type: "input", data: typeof data === "string" ? bytes(data) : data })
      },
    }),
    control: Object.assign(view(isControl), {
      resize(next: Size): void {
        rows.push({ at: nextAt(), type: "control", control: "resize", size: { ...next } })
      },
      setMode(mode: Parameters<NonNullable<Session["control"]>["setMode"]>[0], enabled: boolean): void {
        rows.push({ at: nextAt(), type: "control", control: "mode", mode, enabled })
      },
      signal(signal: string): void {
        rows.push({ at: nextAt(), type: "control", control: "signal", signal })
      },
    }),
    events: walk,
    size,
    exited: Promise.resolve(exit),
  }
}

/** Drain any async iterable into an array. */
export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of source) out.push(item)
  return out
}

/**
 * The Session conformance check: every member is a filtered view of
 * `events()` — same rows, same order, nothing added, nothing reordered.
 *
 * Phase A2 runs this against the real spawn/attach/wrap/replay sessions.
 */
export async function assertMembersAreViewsOfEvents(session: Session): Promise<void> {
  const all = await collect(session.events())

  expect(await collect(session.output)).toEqual(all.filter((e) => e.type === "output"))
  expect(await collect(session.input)).toEqual(all.filter((e) => e.type === "input"))

  if (session.control !== undefined) {
    expect(await collect(session.control)).toEqual(all.filter((e) => e.type === "control"))
  }
}
