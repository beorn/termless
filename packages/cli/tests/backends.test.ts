import { describe, expect, it } from "vitest"
import { Command } from "@silvery/commander"

import { registerBackendCommand } from "../src/backend-cmd.tsx"

describe("termless backends update --apply wiring (25141 item 1)", () => {
  it("passes apply: true to updateAction when --apply flag is given", async () => {
    const receivedOpts: Array<{ apply?: boolean }> = []
    const program = new Command()
    registerBackendCommand(program, {
      updateAction: async (opts) => {
        receivedOpts.push(opts)
      },
    })

    await program.parseAsync(["node", "termless", "backends", "update", "--apply"])

    expect(receivedOpts).toHaveLength(1)
    expect(receivedOpts[0]?.apply).toBe(true)
  })

  it("passes apply as undefined when --apply flag is omitted", async () => {
    const receivedOpts: Array<{ apply?: boolean }> = []
    const program = new Command()
    registerBackendCommand(program, {
      updateAction: async (opts) => {
        receivedOpts.push(opts)
      },
    })

    await program.parseAsync(["node", "termless", "backends", "update"])

    expect(receivedOpts).toHaveLength(1)
    expect(receivedOpts[0]?.apply).toBeUndefined()
  })
})
