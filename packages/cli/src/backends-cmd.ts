/**
 * `termless backends` — list all backends and their status.
 */

import type { Command } from "commander"
import { loadManifest, getBackendStatus, defaultBackendNames } from "../../../src/backends.ts"

export function registerBackendsCommand(program: Command): void {
  program
    .command("backends")
    .description("List all backends and their install status")
    .action(() => {
      const manifest = loadManifest()
      const statuses = getBackendStatus()
      const defaults = new Set(defaultBackendNames())

      // Build rows
      const rows = statuses.map((s) => {
        const isDefault = defaults.has(s.name)
        const nameWithType = `${s.name} (${s.manifest.type})`

        const upstream = s.manifest.upstream ?? ""
        const version = s.manifest.upstreamVersion ?? ""

        let status: string
        if (s.installed) {
          status = isDefault ? "✓ installed (default)" : "✓ installed"
        } else {
          status = "available"
        }

        return { nameWithType, upstream, version, status }
      })

      // Compute column widths
      const col1 = Math.max("Backend".length, ...rows.map((r) => r.nameWithType.length))
      const col2 = Math.max("Upstream".length, ...rows.map((r) => r.upstream.length))
      const col3 = Math.max("Version".length, ...rows.map((r) => r.version.length))

      console.log(`\ntermless v${manifest.version}\n`)

      // Header
      console.log(`  ${"Backend".padEnd(col1)}  ${"Upstream".padEnd(col2)}  ${"Version".padEnd(col3)}  Status`)
      console.log(`  ${"─".repeat(col1)}  ${"─".repeat(col2)}  ${"─".repeat(col3)}  ${"─".repeat(20)}`)

      // Rows
      for (const r of rows) {
        console.log(
          `  ${r.nameWithType.padEnd(col1)}  ${r.upstream.padEnd(col2)}  ${r.version.padEnd(col3)}  ${r.status}`,
        )
      }

      // Footer
      const installedCount = statuses.filter((s) => s.installed).length
      const totalCount = statuses.length
      console.log(`\n  ${installedCount} of ${totalCount} installed`)
      if (installedCount < totalCount) {
        console.log("  bunx termless install <name>")
        console.log("  bunx termless install --all")
      }
      console.log("  https://termless.dev/guide/backends\n")
    })
}
