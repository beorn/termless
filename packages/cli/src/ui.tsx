/**
 * Reusable UI components for termless CLI output.
 *
 * Built on silvery's Box, Text, and Table components for semantic
 * colors and flexbox layout.
 */

import React from "react"
import { Box, Text, Table, type TableColumn } from "silvery"

// =============================================================================
// Types
// =============================================================================

export interface BackendRow {
  name: string
  isDefault: boolean
  installed: boolean
  installedVersion: string | null
  upstream: string
  type: string
}

// =============================================================================
// Components
// =============================================================================

export function Header({ title, version }: { title: string; version?: string }): React.ReactElement {
  return (
    <Box marginBottom={1}>
      <Text bold color="$primary">
        {title}
      </Text>
      {version && <Text color="$muted"> v{version}</Text>}
    </Box>
  )
}

export function StatusLine({
  icon,
  variant,
  children,
}: {
  icon: string
  variant: "success" | "error" | "warning" | "muted"
  children: React.ReactNode
}): React.ReactElement {
  const color = `$${variant}`
  return (
    <Box>
      <Text color={color}>{icon} </Text>
      <Text>{children}</Text>
    </Box>
  )
}

type BackendsTableRow = { backend: string; status: string; upstream: string }

export function BackendsTable({ rows }: { rows: BackendRow[] }): React.ReactElement {
  const columns: TableColumn<BackendsTableRow>[] = [
    { header: "Backend", key: "backend" },
    { header: "Status", key: "status" },
    { header: "Upstream", key: "upstream" },
  ]

  const data: BackendsTableRow[] = rows.map((r) => ({
    backend: `${r.name} (${r.type})${r.isDefault ? " *" : ""}`,
    status: r.installed ? `✓ installed` : "✗ not installed",
    upstream: r.upstream,
  }))

  return <Table columns={columns} data={data} />
}

export function Summary({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text color="$muted">{children}</Text>
    </Box>
  )
}
