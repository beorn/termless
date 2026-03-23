/**
 * `termless doctor` — comprehensive health check of all backends.
 *
 * For each backend: checks install status, and for installed ones,
 * runs a health check (resolve -> init -> feed -> getText -> destroy).
 * Reports capabilities and overall summary.
 */

import type { Command } from "commander"
import { manifest, backends, entry, isReady, getInstalledVersion, backend } from "../../../src/backends.ts"

/** Run a health check on a single backend: resolve, init, feed, read, destroy. */
async function checkHealth(name: string): Promise<{
  name: string
  healthy: boolean
  capabilities?: string
  error?: string
}> {
  try {
    const b = await backend(name)
    b.init({ cols: 80, rows: 24 })
    b.feed(new TextEncoder().encode("Hello"))
    const ok = b.getText().includes("Hello")
    const caps = b.capabilities
    b.destroy()
    return {
      name,
      healthy: ok,
      capabilities: `${caps.name} (truecolor: ${caps.truecolor}, kitty: ${caps.kittyKeyboard})`,
    }
  } catch (e) {
    return { name, healthy: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check health of all backends")
    .action(async () => {
      const m = manifest()
      const allNames = backends()

      console.log(`\ntermless doctor v${m.version}\n`)
      console.log("Checking backends...\n")

      let healthy = 0
      let unhealthy = 0
      let notInstalled = 0

      for (const name of allNames) {
        const e = entry(name)!
        const installed = isReady(name)

        if (!installed) {
          console.log(`  \u2500 ${name.padEnd(12)} not installed`)
          notInstalled++
          continue
        }

        // Run health check
        const result = await checkHealth(name)

        // Format upstream info
        let upstreamStr: string
        if (!e.upstream) {
          upstreamStr = e.type === "os" ? "(OS automation)" : "(built-in)"
        } else {
          const ver = e.version ? ` ${e.version}` : ""
          upstreamStr = `${e.upstream}${ver}`
        }

        const verStr = getInstalledVersion(e.package) ?? "unknown"

        if (result.healthy) {
          console.log(`  \u2713 ${name.padEnd(12)} ${verStr.padEnd(7)} ${upstreamStr}`)
          if (result.capabilities) {
            console.log(`    \u2192 ${result.capabilities}`)
          }
          healthy++
        } else {
          console.log(`  \u2717 ${name.padEnd(12)} ${verStr.padEnd(7)} ${upstreamStr}`)
          if (result.error) {
            console.log(`    \u2192 Error: ${result.error}`)
          }
          unhealthy++
        }
      }

      // Summary
      console.log(`\n  ${healthy} healthy, ${unhealthy} unhealthy, ${notInstalled} not installed`)

      if (unhealthy === 0 && healthy > 0) {
        console.log("  All installed backends are healthy.\n")
      } else if (unhealthy > 0) {
        console.log("  Some backends are unhealthy. Run `termless install` to reinstall.\n")
        process.exitCode = 1
      } else {
        console.log("  No backends installed. Run `termless install` to get started.\n")
      }
    })
}
