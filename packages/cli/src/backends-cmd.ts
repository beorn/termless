/**
 * `termless backends` — list all backends and their install status.
 *
 * Shows a formatted table with backend name, install status,
 * upstream info, type, and whether it's a default backend.
 */

import type { Command } from "commander"
import { loadManifest, getBackendStatus, defaultBackendNames } from "../../../src/registry.ts"

export function registerBackendsCommand(program: Command): void {
  program
    .command("backends")
    .description("List all backends and their install status")
    .action(() => {
      const manifest = loadManifest()
      const statuses = getBackendStatus()
      const defaults = new Set(defaultBackendNames())

      console.log(`\ntermless v${manifest.version} — Backend Status\n`)

      // Column headers
      const cols = {
        name: "Backend",
        installed: "Installed",
        upstream: "Upstream",
        type: "Type",
      }

      // Compute column widths from data
      const nameWidth = Math.max(cols.name.length, ...statuses.map((s) => s.name.length))
      const installedWidth = Math.max(cols.installed.length, "\u2713 yes".length, "\u2717 no".length)
      const upstreamWidth = Math.max(
        cols.upstream.length,
        ...statuses.map((s) => {
          if (!s.manifest.upstream) {
            return s.manifest.type === "os" ? "(OS automation)".length : "(built-in)".length
          }
          const ver = s.manifest.upstreamVersion ? ` ${s.manifest.upstreamVersion}` : ""
          return `${s.manifest.upstream}${ver}`.length
        }),
      )
      const typeWidth = Math.max(cols.type.length, ...statuses.map((s) => s.manifest.type.length))

      // Header
      console.log(
        `  ${cols.name.padEnd(nameWidth)}   ${cols.installed.padEnd(installedWidth)}   ${cols.upstream.padEnd(upstreamWidth)}   ${cols.type.padEnd(typeWidth)}`,
      )
      // Separator using em dashes
      console.log(
        `  ${"─".repeat(nameWidth)}   ${"─".repeat(installedWidth)}   ${"─".repeat(upstreamWidth)}   ${"─".repeat(typeWidth)}`,
      )

      // Rows
      for (const s of statuses) {
        const isDefault = defaults.has(s.name)
        const nameStr = s.name.padEnd(nameWidth)
        const installedStr = s.installed ? "\u2713 yes" : "\u2717 no"

        let upstreamStr: string
        if (!s.manifest.upstream) {
          upstreamStr = s.manifest.type === "os" ? "(OS automation)" : "(built-in)"
        } else {
          const ver = s.manifest.upstreamVersion ? ` ${s.manifest.upstreamVersion}` : ""
          upstreamStr = `${s.manifest.upstream}${ver}`
        }

        const suffix = isDefault ? "  (default)" : ""

        console.log(
          `  ${nameStr}   ${installedStr.padEnd(installedWidth)}   ${upstreamStr.padEnd(upstreamWidth)}   ${s.manifest.type.padEnd(typeWidth)}${suffix}`,
        )
      }

      // Summary
      const installedCount = statuses.filter((s) => s.installed).length
      const totalCount = statuses.length
      const defaultCount = defaults.size
      console.log(`\n  ${installedCount} of ${totalCount} installed \u00b7 ${defaultCount} default (marked above)`)
      if (installedCount < totalCount) {
        console.log("  Install more: bunx termless install <name>")
        console.log("  Install all:  bunx termless install --all")
      }
      console.log("  Docs: https://termless.dev/guide/backends\n")
    })
}
