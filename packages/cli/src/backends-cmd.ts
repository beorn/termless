/**
 * `termless backends` — list all backends and their status.
 */

import type { Command } from "commander"
import { manifest, backends, entry, isReady } from "../../../src/backends.ts"

/** Print the full backends table with status. Shared by `backends` and `install` commands. */
export function printBackendsTable(): void {
  const m = manifest()
  const allNames = backends()
  const defaultNames = new Set(allNames.filter((name) => entry(name)?.default))

  // Build rows
  const rows = allNames.map((name) => {
    const e = entry(name)!
    const installed = isReady(name)
    const isDefault = defaultNames.has(name)
    const nameWithType = `${name} (${e.type})`

    const upstream = e.upstream ?? ""
    const version = e.version ?? ""

    let status: string
    if (installed) {
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

  console.log(`\ntermless v${m.version}\n`)

  // Header
  console.log(`  ${"Backend".padEnd(col1)}  ${"Upstream".padEnd(col2)}  ${"Version".padEnd(col3)}  Status`)
  console.log(`  ${"─".repeat(col1)}  ${"─".repeat(col2)}  ${"─".repeat(col3)}  ${"─".repeat(20)}`)

  // Rows
  for (const r of rows) {
    console.log(`  ${r.nameWithType.padEnd(col1)}  ${r.upstream.padEnd(col2)}  ${r.version.padEnd(col3)}  ${r.status}`)
  }

  // Footer
  const installedCount = allNames.filter(isReady).length
  const totalCount = allNames.length
  console.log(`\n  ${installedCount} of ${totalCount} installed`)
  if (installedCount < totalCount) {
    console.log("  bunx termless install <name>")
    console.log("  bunx termless install --all")
  }
  console.log("  https://termless.dev/guide/backends\n")
}

export function registerBackendsCommand(program: Command): void {
  program
    .command("backends")
    .description("List all backends and their install status")
    .action(() => {
      printBackendsTable()
    })
}
