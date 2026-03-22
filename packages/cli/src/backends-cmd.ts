/**
 * `termless backends` — list all backends and their install status.
 *
 * Shows a formatted table with backend name, installed version,
 * upstream info, and type. Default backends are marked with *.
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

      console.error(`\ntermless v${manifest.version} — Backend Status\n`)

      // Column headers
      const cols = {
        name: "Backend",
        status: "Status",
        upstream: "Upstream",
        type: "Type",
      }

      // Compute column widths from data
      const nameWidth = Math.max(
        cols.name.length,
        ...statuses.map((s) => s.name.length + (defaults.has(s.name) ? 2 : 0)),
      )
      const statusWidth = Math.max(
        cols.status.length,
        ...statuses.map((s) =>
          s.installed ? `\u2713 ${s.installedVersion ?? "unknown"}`.length : "\u2717 not installed".length,
        ),
      )
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
      console.error(
        `  ${cols.name.padEnd(nameWidth)}  ${cols.status.padEnd(statusWidth)}  ${cols.upstream.padEnd(upstreamWidth)}  ${cols.type}`,
      )
      // Separator using em dashes
      console.error(
        `  ${"─".repeat(nameWidth)}  ${"─".repeat(statusWidth)}  ${"─".repeat(upstreamWidth)}  ${"─".repeat(typeWidth)}`,
      )

      // Rows
      for (const s of statuses) {
        const isDefault = defaults.has(s.name)
        const nameStr = (s.name + (isDefault ? " *" : "")).padEnd(nameWidth)

        const statusStr = s.installed ? `\u2713 ${s.installedVersion ?? "unknown"}` : "\u2717 not installed"

        let upstreamStr: string
        if (!s.manifest.upstream) {
          upstreamStr = s.manifest.type === "os" ? "(OS automation)" : "(built-in)"
        } else {
          const ver = s.manifest.upstreamVersion ? ` ${s.manifest.upstreamVersion}` : ""
          upstreamStr = `${s.manifest.upstream}${ver}`
        }

        console.error(
          `  ${nameStr}  ${statusStr.padEnd(statusWidth)}  ${upstreamStr.padEnd(upstreamWidth)}  ${s.manifest.type}`,
        )
      }

      // Summary
      const installedCount = statuses.filter((s) => s.installed).length
      const totalCount = statuses.length
      const defaultCount = defaults.size
      console.error(`\n  ${installedCount} of ${totalCount} installed (${defaultCount} default)`)
      if (installedCount < totalCount) {
        console.error("  Install more: npx termless install <name>\n")
      } else {
        console.error("")
      }
    })
}
