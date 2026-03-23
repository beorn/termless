/**
 * Census report rendering — silvery-powered capability matrix.
 *
 * Renders a colored matrix showing pass/fail for each feature across backends,
 * grouped by category with summary bars.
 */

import React from "react"
import { renderString } from "silvery"
import { Box, Text } from "silvery"
import type { CensusData } from "./parse.ts"

// ── Components ──

function Header({ featureCount, backendCount }: { featureCount: number; backendCount: number }): React.ReactElement {
  return (
    <Box marginBottom={1}>
      <Text bold color="$primary">
        @termless/census
      </Text>
      <Text color="$muted">
        {" "}
        — {featureCount} features × {backendCount} backends
      </Text>
    </Box>
  )
}

function SummaryBar({ name, yes, total }: { name: string; yes: number; total: number }): React.ReactElement {
  const pct = Math.round((yes / (total || 1)) * 100)
  const filled = Math.round(pct / 5)
  const empty = 20 - filled
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty)

  return (
    <Box>
      <Text color="$primary" bold>
        {"  "}
        {name.padEnd(16)}
      </Text>
      <Text>
        {String(yes).padStart(3)}/{total}{" "}
      </Text>
      <Text color={pct >= 90 ? "$success" : pct >= 70 ? "$warning" : "$error"}>{bar}</Text>
      <Text> {pct}%</Text>
    </Box>
  )
}

function SummarySection({ data }: { data: CensusData }): React.ReactElement {
  const bars = data.backendNames.map((name) => {
    const features = data.results.get(name)!
    let yes = 0
    for (const r of features.values()) {
      if (r) yes++
    }
    return <SummaryBar key={name} name={name} yes={yes} total={features.size} />
  })

  return <Box flexDirection="column">{bars}</Box>
}

// Column widths
const FEATURE_COL = 30

function centerPad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  const left = Math.floor((width - text.length) / 2)
  const right = width - text.length - left
  return " ".repeat(left) + text + " ".repeat(right)
}

function CategoryMatrix({ data }: { data: CensusData }): React.ReactElement {
  // Backend column width — fit the longest name + 2 padding
  const backendCol = Math.max(6, ...data.backendNames.map((n) => n.length)) + 2
  const headerCells = data.backendNames.map((n) => centerPad(n, backendCol)).join("")

  const sections: React.ReactElement[] = []

  for (const [cat, ids] of data.categories) {
    const rows: React.ReactElement[] = []

    for (const id of ids) {
      const suffix = id.slice(cat.length + 1)
      const cells: React.ReactElement[] = data.backendNames.map((name, i) => {
        const r = data.results.get(name)!.get(id)
        return r ? (
          <Text key={i} color="$success">
            {centerPad("✓", backendCol)}
          </Text>
        ) : (
          <Text key={i} color="$error">
            {centerPad("✗", backendCol)}
          </Text>
        )
      })

      rows.push(
        <Box key={id}>
          <Text>{("    " + suffix).padEnd(FEATURE_COL)}</Text>
          {cells}
        </Box>,
      )
    }

    sections.push(
      <Box key={cat} flexDirection="column" marginBottom={1}>
        <Box>
          <Text bold>{"  " + cat + ":"}</Text>
        </Box>
        {rows}
      </Box>,
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text bold color="$muted">
          {"  Feature".padEnd(FEATURE_COL)}
        </Text>
        <Text bold>{headerCells}</Text>
      </Box>
      {sections}
    </Box>
  )
}

function FileOutput({ paths }: { paths: string[] }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      {paths.map((p) => (
        <Box key={p}>
          <Text color="$muted">{"  Wrote: "}</Text>
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
