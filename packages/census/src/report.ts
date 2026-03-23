#!/usr/bin/env bun
/**
 * Census report generator — reads vitest JSON output from stdin,
 * prints a capability matrix, writes census/results/current.json
 * and per-backend result files (e.g., xtermjs-5.5.0.json).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const input = await Bun.stdin.text()
const json = JSON.parse(input)

// Parse vitest JSON → backend/feature results
// Result is now simply boolean: true = pass, false = fail
const backends = new Map<string, Map<string, boolean>>()
const testNotes = new Map<string, Map<string, string>>()

for (const file of json.testResults ?? []) {
  for (const test of file.assertionResults ?? []) {
    // ancestorTitles: [backend, category]
    const titles: string[] = test.ancestorTitles ?? []
    const backend = titles[0] ?? "unknown"
    const id = test.title ?? "unknown"

    if (!backends.has(backend)) backends.set(backend, new Map())
    if (!testNotes.has(backend)) testNotes.set(backend, new Map())
    const features = backends.get(backend)!
    const notes = testNotes.get(backend)!

    const result = test.status === "passed"
    features.set(id, result)

    // Capture failure messages as notes
    if (!result) {
      const failureMessages: string[] = test.failureMessages ?? []
      const failureText = failureMessages.join("; ").trim()
      if (failureText) {
        notes.set(id, failureText)
      }
    }
  }
}

// Print matrix
const backendNames = [...backends.keys()]
const featureCount = backends.get(backendNames[0]!)?.size ?? 0

console.log(`\n@termless/census — ${featureCount} features × ${backendNames.length} backends\n`)

for (const name of backendNames) {
  const features = backends.get(name)!
  let yes = 0
  let no = 0
  for (const [, r] of features) {
    if (r) yes++
    else no++
  }
  const total = features.size
  const pct = Math.round((yes / (total || 1)) * 100)
  const bar = "\u2588".repeat(Math.round(pct / 5)) + "\u2591".repeat(20 - Math.round(pct / 5))
  console.log(`  ${name.padEnd(14)} ${String(yes).padStart(3)}/${total}  ${bar}  ${pct}%`)
}

// Build hierarchical matrix from dot paths
const allIds = new Set<string>()
for (const features of backends.values()) {
  for (const id of features.keys()) allIds.add(id)
}
const sortedIds = [...allIds].sort()

// Group by top-level category
const categories = new Map<string, string[]>()
for (const id of sortedIds) {
  const cat = id.split(".")[0]!
  if (!categories.has(cat)) categories.set(cat, [])
  categories.get(cat)!.push(id)
}

console.log("\nDetailed results:\n")
for (const [cat, ids] of categories) {
  console.log(`  ${cat}:`)
  for (const id of ids) {
    const suffix = id.slice(cat.length + 1)
    const statuses = backendNames.map((name) => {
      const r = backends.get(name)!.get(id)
      return r ? "\u2713" : "\u2717"
    })
    console.log(`    ${suffix.padEnd(24)} ${statuses.join("  ")}`)
  }
}
console.log(`\n  ${"".padEnd(28)} ${backendNames.map((n) => n.slice(0, 5).padEnd(5)).join("  ")}`)

// Write JSON
const resultsOutput: Record<string, Record<string, boolean>> = {}
const notesOutput: Record<string, Record<string, string>> = {}

for (const name of backendNames) {
  const features = backends.get(name)!
  const notes = testNotes.get(name)!
  resultsOutput[name] = Object.fromEntries(features)
  if (notes.size > 0) {
    notesOutput[name] = Object.fromEntries(notes)
  }
}

const output = {
  generated: new Date().toISOString(),
  backends: backendNames,
  results: resultsOutput,
  ...(Object.keys(notesOutput).length > 0 ? { notes: notesOutput } : {}),
}

mkdirSync("census/results", { recursive: true })
writeFileSync("census/results/current.json", JSON.stringify(output, null, 2))
console.log(`\n  Wrote: census/results/current.json`)

// ── Per-backend result files ──
// Read backends.json to get upstream versions for filenames.
const __dirname = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(__dirname, "..", "..", "..", "backends.json")
let manifest: { backends: Record<string, { upstreamVersion: string | null }> } | null = null
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"))
} catch {
  // If manifest can't be read, fall back to "latest" for all versions
}

const generated = output.generated
for (const name of backendNames) {
  const features = backends.get(name)!
  const notes = testNotes.get(name)!
  const version = manifest?.backends[name]?.upstreamVersion ?? "latest"
  const filename = `${name}-${version}.json`

  const perBackend = {
    backend: name,
    version,
    generated,
    results: Object.fromEntries(features),
    ...(notes.size > 0 ? { notes: Object.fromEntries(notes) } : {}),
  }

  writeFileSync(`census/results/${filename}`, JSON.stringify(perBackend, null, 2))
  console.log(`  Wrote: census/results/${filename}`)
}

console.log("")
