/**
 * `termless doctor` — comprehensive health check of all backends.
 *
 * For each backend: checks install status, and for installed ones,
 * runs a health check (resolve -> init -> feed -> getText -> destroy).
 * Reports capabilities and overall summary.
 */

import type { Command } from "commander"
import { loadManifest, getBackendStatus, checkBackendHealth } from "../../../src/backends.ts"

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check health of all backends")
    .action(async () => {
      const manifest = loadManifest()
      const statuses = getBackendStatus()

      console.log(`\ntermless doctor v${manifest.version}\n`)
      console.log("Checking backends...\n")

      let healthy = 0
      let unhealthy = 0
      let notInstalled = 0

      for (const s of statuses) {
        if (!s.installed) {
          // Not installed
          console.log(`  \u2500 ${s.name.padEnd(12)} not installed`)
          notInstalled++
          continue
        }

        // Run health check
        const result = await checkBackendHealth(s.name)

        // Format upstream info
        let upstreamStr: string
        if (!s.manifest.upstream) {
          upstreamStr = s.manifest.type === "os" ? "(OS automation)" : "(built-in)"
        } else {
          const ver = s.manifest.upstreamVersion ? ` ${s.manifest.upstreamVersion}` : ""
          upstreamStr = `${s.manifest.upstream}${ver}`
        }

        const verStr = s.installedVersion ?? "unknown"

        if (result.healthy) {
          console.log(`  \u2713 ${s.name.padEnd(12)} ${verStr.padEnd(7)} ${upstreamStr}`)
          if (result.capabilities) {
            console.log(`    \u2192 ${result.capabilities}`)
          }
          healthy++
        } else {
          console.log(`  \u2717 ${s.name.padEnd(12)} ${verStr.padEnd(7)} ${upstreamStr}`)
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
