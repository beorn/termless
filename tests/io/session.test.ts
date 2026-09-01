/**
 * Session — `events()` is THE primitive, the members are filtered views.
 *
 * The invariant under test: `output`, `input` and `control` never carry a row
 * `events()` does not, never carry them in a different order, and never
 * constitute a second truth.
 */

import { describe, expect, test } from "vitest"
import { assertMembersAreViewsOfEvents, collect, conformanceEvents, fakeSession, text } from "./fixtures.ts"

describe("Session", () => {
  test("members are filtered views of events() — same rows, same order", async () => {
    await assertMembersAreViewsOfEvents(fakeSession())
  })

  test("output carries only what the program wrote", async () => {
    const session = fakeSession()
    const output = await collect(session.output)

    expect(output.map((e) => text(e.data))).toEqual(["hello", " world"])
    expect(output.every((e) => e.type === "output")).toBe(true)
  })

  test("control carries the typed non-byte channel", async () => {
    const session = fakeSession()
    const control = await collect(session.control!)

    expect(control.map((e) => e.control)).toEqual(["resize", "signal"])
  })

  test("a write through input shows up in events() in the same position", async () => {
    const session = fakeSession()
    await session.input.write("extra")

    const all = await collect(session.events())
    const inputs = await collect(session.input)

    expect(inputs).toEqual(all.filter((e) => e.type === "input"))
    expect(text(inputs[inputs.length - 1]!.data)).toBe("extra")

    // The invariant still holds after the session was written to.
    await assertMembersAreViewsOfEvents(session)
  })

  test("a resize through control shows up in events() and moves size forward", async () => {
    const session = fakeSession()
    await session.control!.resize({ cols: 120, rows: 40 })

    const control = await collect(session.control!)
    const last = control[control.length - 1]!

    expect(last).toMatchObject({ control: "resize", size: { cols: 120, rows: 40 } })
    await assertMembersAreViewsOfEvents(session)
  })

  test("exited resolves with the exit event's code and signal", async () => {
    await expect(fakeSession().exited).resolves.toEqual({ code: 0, signal: null })
  })

  test("control is optional — a session without one still satisfies the contract", async () => {
    const withoutControl = { ...fakeSession(), control: undefined }
    await assertMembersAreViewsOfEvents(withoutControl)
    expect(withoutControl.control).toBeUndefined()
  })

  test("the conformance stream exercises every event type", async () => {
    const seen = new Set(conformanceEvents().map((e) => e.type))
    expect([...seen].sort()).toEqual(["control", "exit", "input", "mark", "output"])
  })
})
