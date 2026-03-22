/**
 * `termless doctor` — comprehensive health check of all backends.
 *
 * For each backend: checks install status, and for installed ones,
 * runs a health check (resolve -> init -> feed -> getText -> destroy).
 * Reports capabilities and overall summary.
 */

import type { Command } from "commander"
import { loadManifest, getBackendStatus, checkBackendHealth } from "../../../src/registry.ts"

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check health of all backends")
    .action(async () => {
      const manifest = loadManifest()
      const statuses = getBackendStatus()

      console.error(`\ntermless doctor v${manifest.version}\n`)
      console.error("Checking backends...\n")

      let healthy = 0
      let unhealthy = 0
      let notInstalled = 0

      for (const s of statuses) {
        if (!s.installed) {
          // Not installed
          console.error(`  \u2500 ${s.name.padEnd(12)} not installed`)
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
          console.error(`  \u2713 ${s.name.padEnd(12)} ${verStr.padEnd(7)} ${upstreamStr}`)
          if (result.capabilities) {
            console.error(`    \u2192 ${result.capabilities}`)
          }
          healthy++
        } else {
          console.error(`  \u2717 ${s.name.padEnd(12)} ${verStr.padEnd(7)} ${upstreamStr}`)
          if (result.error) {
            console.error(`    \u2192 Error: ${result.error}`)
          }
          unhealthy++
        }
      }

      // Summary
      console.error(`\n  ${healthy} healthy, ${unhealthy} unhealthy, ${notInstalled} not installed`)

      if (unhealthy === 0 && healthy > 0) {
        console.error("  All installed backends are healthy.\n")
      } else if (unhealthy > 0) {
        console.error("  Some backends are unhealthy. Run `termless install` to reinstall.\n")
        process.exitCode = 1
      } else {
        console.error("  No backends installed. Run `termless install` to get started.\n")
      }
    })
}
