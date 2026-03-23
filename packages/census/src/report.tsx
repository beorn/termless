/**
 * Census report rendering — silvery-powered capability matrix.
 *
 * Uses silvery Box/Text flexbox layout — no manual padEnd or dimension constants.
 */

import React from "react"
import { renderString } from "silvery"
import { Box, Text } from "silvery"
import type { CensusData } from "./parse.ts"
import { backends as allBackendNames, isReady, entry } from "../../../src/backends.ts"

// ── Types ──

interface BackendStatus {
  name: string
  type: string
  installed: boolean
  tested: boolean
  yes?: number
  total?: number
}

// ── Components ──

function Header({ featureCount, backendCount }: { featureCount: number; backendCount: number }): React.ReactElement {
  return (
    <Box marginBottom={1}>
      <Text bold color="$primary">@termless/census</Text>
      <Text color="$muted"> — {featureCount} features × {backendCount} backends</Text>
    </Box>
  )
}

function ProgressBar({ pct }: { pct: number }): React.ReactElement {
  const filled = Math.round(pct / 5)
  const bar = "█".repeat(filled) + "░".repeat(20 - filled)
  const color = pct >= 90 ? "$success" : pct >= 70 ? "$warning" : "$error"
  return <Text color={color}>{bar}</Text>
}

function BackendLine({ b, labelWidth }: { b: BackendStatus; labelWidth: number }): React.ReactElement {
  const label = `${b.name} (${b.type})`

  if (!b.installed) {
    return (
      <Box marginLeft={2}>
        <Box width={labelWidth}><Text color="$muted">{label}</Text></Box>
        <Text color="$muted">not installed</Text>
      </Box>
    )
  }

  if (!b.tested) {
    return (
      <Box marginLeft={2}>
        <Box width={labelWidth}><Text color="$muted">{label}</Text></Box>
        <Text color="$muted">installed, not tested</Text>
      </Box>
    )
  }

  const pct = Math.round(((b.yes ?? 0) / (b.total || 1)) * 100)

  return (
    <Box marginLeft={2}>
      <Box width={labelWidth}><Text bold>{label}</Text></Box>
      <Text>{String(b.yes).padStart(3)}/{b.total} </Text>
      <ProgressBar pct={pct} />
      <Text> {pct}%</Text>
    </Box>
  )
}

function SummarySection({ data }: { data: CensusData }): React.ReactElement {
  const statuses: BackendStatus[] = allBackendNames().map((name) => {
    const e = entry(name)
    const installed = isReady(name)
    const tested = data.backendNames.includes(name)
    let yes = 0
    let total = 0
    if (tested) {
      const features = data.results.get(name)!
      total = features.size
      for (const r of features.values()) {
        if (r) yes++
      }
    }
    return { name, type: e?.type ?? "unknown", installed, tested, yes, total }
  })

  // Compute label width from longest "name (type)" string
  const labelWidth = Math.max(...statuses.map((b) => `${b.name} (${b.type})`.length)) + 2

  return (
    <Box flexDirection="column">
      {statuses.map((b) => <BackendLine key={b.name} b={b} labelWidth={labelWidth} />)}
    </Box>
  )
}

function MatrixCell({ pass, width }: { pass: boolean; width: number }): React.ReactElement {
  return (
    <Box width={width} justifyContent="center">
      <Text color={pass ? "$success" : "$error"}>{pass ? "✓" : "✗"}</Text>
    </Box>
  )
}

function CategoryMatrix({ data }: { data: CensusData }): React.ReactElement {
  // Column width derived from longest backend name
  const colWidth = Math.max(6, ...data.backendNames.map((n) => n.length)) + 2
  const featureWidth = 30

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header row */}
      <Box marginBottom={1}>
        <Box width={featureWidth} marginLeft={2}>
          <Text bold color="$muted">Feature</Text>
        </Box>
        {data.backendNames.map((name) => (
          <Box key={name} width={colWidth} justifyContent="center">
            <Text bold>{name}</Text>
          </Box>
        ))}
      </Box>

      {/* Category sections */}
      {[...data.categories.entries()].map(([cat, ids]) => (
        <Box key={cat} flexDirection="column" marginBottom={1}>
          <Box marginLeft={2}>
            <Text bold>{cat}:</Text>
          </Box>
          {ids.map((id) => {
            const suffix = id.slice(cat.length + 1)
            return (
              <Box key={id}>
                <Box width={featureWidth} marginLeft={4}>
                  <Text>{suffix}</Text>
                </Box>
                {data.backendNames.map((name) => (
                  <MatrixCell key={name} pass={data.results.get(name)!.get(id) ?? false} width={colWidth} />
                ))}
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

function FileOutput({ paths }: { paths: string[] }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      {paths.map((p) => (
        <Box key={p} marginLeft={2}>
          <Text color="$muted">Wrote: </Text>
          <Text>{p}</Text>
        </Box>
      ))}
    </Box>
  )
}

export function CensusReport({
  data,
  writtenFiles,
}: {
  data: CensusData
  writtenFiles?: string[]
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Header featureCount={data.featureIds.length} backendCount={data.backendNames.length} />
      <SummarySection data={data} />
      <CategoryMatrix data={data} />
      {writtenFiles && writtenFiles.length > 0 && <FileOutput paths={writtenFiles} />}
    </Box>
  )
}

/**
 * Render the census report to a string via silvery.
 */
export async function renderReport(data: CensusData, opts?: { writtenFiles?: string[] }): Promise<string> {
  const width = process.stdout.columns || 120
  return renderString(React.createElement(CensusReport, { data, writtenFiles: opts?.writtenFiles }), { width })
}
