/**
 * `termless backends` -- list all backends and their install status.
 *
 * Shows a formatted table with backend name, installed version,
 * upstream info, and type. Default backends are marked with *.
 */

import React from "react"
import { Box, Text } from "silvery"
import type { Command } from "commander"
import { manifest, backends, entry, isReady, getInstalledVersion } from "../../../src/backends.ts"
import { printComponent } from "./render.tsx"
import { Header, BackendsTable, Summary, type BackendRow } from "./ui.tsx"

// =============================================================================
// Helpers
// =============================================================================

function buildBackendRows(): { rows: BackendRow[]; version: string } {
  const m = manifest()
  const allNames = backends()
  const defaultNames = new Set(allNames.filter((name) => entry(name)?.default))

  const rows: BackendRow[] = allNames.map((name) => {
    const e = entry(name)!
    const installed = isReady(name)

    let upstream: string
    if (!e.upstream) {
      upstream = e.type === "os" ? "(OS automation)" : "(built-in)"
    } else {
      const ver = e.version ? ` ${e.version}` : ""
      upstream = `${e.upstream}${ver}`
    }

    return {
      name,
      isDefault: defaultNames.has(name),
      installed,
      installedVersion: installed ? getInstalledVersion(e.package) : null,
      upstream,
      type: e.type,
    }
  })

  return { rows, version: m.version }
}

// =============================================================================
// Component
// =============================================================================

function BackendsView({ rows, version }: { rows: BackendRow[]; version: string }): React.ReactElement {
  const installedCount = rows.filter((r) => r.installed).length
  const totalCount = rows.length
  const defaultCount = rows.filter((r) => r.isDefault).length

  return (
    <Box flexDirection="column">
      <Header title="termless" version={version} />
      <BackendsTable rows={rows} />
      <Summary>
        {installedCount} of {totalCount} installed ({defaultCount} default, marked *)
      </Summary>
      {installedCount < totalCount && (
        <Box>
          <Text color="$muted"> bunx termless install {"<name>"}</Text>
        </Box>
      )}
      <Box>
        <Text color="$muted"> https://termless.dev/guide/backends</Text>
      </Box>
    </Box>
  )
}

// =============================================================================
// Shared function (used by install-cmd too)
// =============================================================================

export async function printBackendsTable(): Promise<void> {
  const { rows, version } = buildBackendRows()
  await printComponent(<BackendsView rows={rows} version={version} />)
}

// =============================================================================
// Command registration
// =============================================================================

export function registerBackendsCommand(program: Command): void {
  program
    .command("backends")
    .description("List all backends and their install status")
    .action(async () => {
      await printBackendsTable()
    })
}
