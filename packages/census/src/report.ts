#!/usr/bin/env bun
/**
 * Census report generator — reads vitest JSON output from stdin,
 * prints a capability matrix, writes census/results/current.json.
 */

import { mkdirSync, writeFileSync } from "node:fs"

const input = await Bun.stdin.text()
const json = JSON.parse(input)

type Support = "yes" | "partial" | "no" | "error"

interface Result {
  support: Support
  notes?: string
}

// Parse vitest JSON → backend/feature results
const backends = new Map<string, Map<string, Result>>()
const descriptions = new Map<string, string>()

for (const file of json.testResults ?? []) {
  for (const test of file.assertionResults ?? []) {
    // ancestorTitles: [backend, category]
    const titles: string[] = test.ancestorTitles ?? []
    const backend = titles[0] ?? "unknown"
    const id = test.title ?? "unknown"
    const desc = test.meta?.description as string | undefined
    if (desc) descriptions.set(id, desc)

    if (!backends.has(backend)) backends.set(backend, new Map())
    const features = backends.get(backend)!

    // vitest --reporter json doesn't include test.meta, so we parse
    // census state from failure messages: [census:partial] or [census:no]
    const failureMessages: string[] = test.failureMessages ?? []
    const failureText = failureMessages.join("\n")

    let support: Support
    let notes: string | undefined

    if (test.status === "passed") {
      support = "yes"
    } else if (failureText.includes("[census:partial]")) {
      support = "partial"
      const match = failureText.match(/\[census:partial]\s*(.*)/)
      notes = match?.[1]?.trim() || undefined
    } else if (failureText.includes("[census:no]")) {
      support = "no"
      const match = failureText.match(/\[census:no]\s*(.*)/)
      notes = match?.[1]?.trim() || undefined
    } else if (test.status === "failed") {
      support = "error"
    } else {
      support = "error"
    }

    features.set(id, { support, ...(notes ? { notes } : {}) })
  }
}

// Print matrix
const backendNames = [...backends.keys()]
const featureCount = backends.get(backendNames[0]!)?.size ?? 0

console.log(`\n@termless/census — ${featureCount} features × ${backendNames.length} backends\n`)

for (const name of backendNames) {
  const features = backends.get(name)!
  let yes = 0
  let partial = 0
  let no = 0
  for (const [, r] of features) {
    if (r.support === "yes") yes++
    else if (r.support === "partial") partial++
    else no++
  }
  const total = features.size
  const pct = Math.round((yes / (total || 1)) * 100)
  const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5))
  const partialStr = partial > 0 ? ` (${partial} partial)` : ""
  console.log(`  ${name.padEnd(14)} ${String(yes).padStart(3)}/${total}  ${bar}  ${pct}%${partialStr}`)
}

// Write JSON
const output = {
  generated: new Date().toISOString(),
  backends: backendNames,
  descriptions: Object.fromEntries(descriptions),
  results: Object.fromEntries(
    [...backends.entries()].map(([name, features]) => [name, Object.fromEntries(features)]),
  ),
}

mkdirSync("census/results", { recursive: true })
writeFileSync("census/results/current.json", JSON.stringify(output, null, 2))
console.log(`\n  Wrote: census/results/current.json\n`)
