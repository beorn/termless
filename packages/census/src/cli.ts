#!/usr/bin/env bun
/**
 * Census CLI — terminal capability census with silvery output.
 *
 * @example
 * ```bash
 * bun census report               # Run probes on all latest backends
 * bun census report --force       # Re-run even if cached
 * bun census report --cached      # Show saved results only
 * bun census report xtermjs       # Just xtermjs, latest
 * bun census report xtermjs/*     # All xtermjs versions (from versions.json)
 * bun census report xtermjs/5.4.0 # Specific version
 * bun census status               # Config, probes, cache
 * ```
 */

import { Command } from "commander"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createLogger } from "loggily"
import { parseVitestJson, fromPerBackendFiles, type CensusData } from "./parse.ts"
import { manifest, backends as allBackendNames, isReady, entry } from "../../../src/backends.ts"
import { renderReport } from "./report.tsx"
import { runVersionedCensus, probeHash, loadVersionsCatalog } from "./versions.ts"

const log = createLogger("census")

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..", "..", "..")
const RESULTS_DIR = join(__dirname, "..", "results")
const MANIFEST_PATH = join(ROOT, "backends.json")

// ── Selector parsing ──

interface BackendSelector {
  backend: string
  version: string | null // null = latest, "*" = all from versions.json
}

/**
 * Parse a selector string into backend name + version.
 *
 * Formats:
 *   "xtermjs"         → { backend: "xtermjs", version: null }
 *   "xtermjs/5.4.0"   → { backend: "xtermjs", version: "5.4.0" }
 *   "xtermjs/*"        → { backend: "xtermjs", version: "*" }
 *   "npm:ghostty-web"  → resolve upstream to backend name, latest
 */
function parseSelector(arg: string): BackendSelector[] {
  // Split on / for version
  const slashIdx = arg.indexOf("/")
  let name: string
  let version: string | null = null

  if (slashIdx >= 0) {
    name = arg.slice(0, slashIdx)
    version = arg.slice(slashIdx + 1) || null
  } else {
    name = arg
  }

  // Resolve upstream URI to backend name (e.g., "npm:ghostty-web" → "ghostty")
  if (name.includes(":")) {
    const m = manifest()
    const match = Object.entries(m.backends).find(([_, e]) => e.upstream === name)
    if (!match) {
      console.error(`No backend found for upstream: ${name}`)
      process.exit(1)
    }
    name = match[0]
  }

  // Validate backend name
  const all = allBackendNames()
  if (!all.includes(name)) {
    console.error(`Unknown backend: ${name}`)
    console.error(`Available: ${all.join(", ")}`)
    process.exit(1)
  }

  // Expand "*" into all versions from versions.json
  if (version === "*") {
    try {
      const catalog = loadVersionsCatalog()
      const config = catalog.backends[name]
      if (!config) {
        console.error(`No version history for ${name} in versions.json`)
        process.exit(1)
      }
      return config.versions.map((v) => ({ backend: name, version: v }))
    } catch {
      console.error(`Could not load versions.json`)
      process.exit(1)
    }
  }

  return [{ backend: name, version }]
}

// ── Commands ──

const installed = allBackendNames().filter(isReady)
const available = allBackendNames().filter((n) => !isReady(n))

const program = new Command()
  .name("census")
  .description(
    `Terminal capability census — probe features across all backends

Examples:
  bun census report               All latest backends
  bun census report --force       Re-run all probes
  bun census report --cached      Show saved results only
  bun census report xtermjs       Just xtermjs, latest
  bun census report xtermjs/*     All xtermjs versions
  bun census report xtermjs/5.4.0 Specific version
  bun census status               Config, probes, cache

Backends (${installed.length} installed): ${installed.join(", ")}${available.length > 0 ? `\nAvailable: ${available.join(", ")}` : ""}`,
  )

program
  .command("report [selectors...]")
  .description("Run probes and show capability matrix")
  .option("-f, --force", "Re-run probes even if cached results are valid")
  .option("--cached", "Show saved results without re-running probes")
  .action(async (selectors: string[], opts: { force?: boolean; cached?: boolean }) => {
    // --cached: just show saved results
    if (opts.cached) {
      const data = loadSavedResults()
      if (!data) {
        console.error("No saved results. Run: bun census report")
        process.exit(1)
      }
      const output = await renderReport(data)
      console.log(output)
      printNotes(data)
      return
    }

    // Parse selectors
    const parsed = selectors.length > 0
      ? selectors.flatMap(parseSelector)
      : null // null = all latest

    // If any selectors request specific versions, run versioned census for those
    const versionedSelectors = parsed?.filter((s) => s.version !== null) ?? []
    const latestSelectors = parsed?.filter((s) => s.version === null) ?? []

    const hash = probeHash()

    // Run latest probes (either all or filtered)
    let latestData: CensusData | null = null

    if (!parsed || latestSelectors.length > 0) {
      // Check cache
      if (!opts.force && !parsed) {
        const cached = loadSavedResults()
        if (cached && isCacheValid(hash)) {
          console.log(`\nCensus results are up to date (probe hash: ${hash}). Use --force to re-run.\n`)
          latestData = cached
        }
      }

      if (!latestData) {
        log.debug?.("Spawning vitest with census config")
        console.log(`\nRunning census probes (hash: ${hash})...\n`)

        const proc = Bun.spawn(["bun", "vitest", "run", "--config", "vitest.census.ts", "--reporter", "json"], {
          cwd: ROOT,
          stdout: "pipe",
          stderr: "pipe",
        })

        const stdout = await new Response(proc.stdout).text()
        await proc.exited

        if (!stdout.trim()) {
          console.error("Error: vitest produced no JSON output")
          process.exit(1)
        }

        try {
          latestData = parseVitestJson(JSON.parse(stdout))
        } catch {
          console.error("Error: failed to parse vitest JSON output")
          process.exit(1)
        }

        if (latestData.backendNames.length === 0) {
          console.error("Error: no backend results found")
          process.exit(1)
        }

        // Filter to requested backends if selectors provided
        if (latestSelectors.length > 0) {
          const names = new Set(latestSelectors.map((s) => s.backend))
          latestData = filterData(latestData, names)
        }

        saveResults(latestData, hash)
      }
    }

    // Run versioned probes if requested
    if (versionedSelectors.length > 0) {
      console.log(`\nRunning versioned probes: ${versionedSelectors.map((s) => `${s.backend}/${s.version}`).join(", ")}\n`)

      const results = await runVersionedCensus({
        force: opts.force,
        // Filter to only requested backend+version pairs
        backends: [...new Set(versionedSelectors.map((s) => s.backend))],
      })

      for (const r of results) {
        if (r.skipped) {
          console.log(`  ${r.backend}@${r.version} — cached`)
        } else if (r.error) {
          console.log(`  ${r.backend}@${r.version} — error: ${r.error}`)
        } else {
          console.log(`  ${r.backend}@${r.version} — ${r.passCount}/${r.featureCount}`)
        }
      }
    }

    // Render report from saved results (includes both latest + versioned)
    const allData = loadSavedResults()
    if (allData) {
      const writtenFiles = existsSync(RESULTS_DIR)
        ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json")).map((f) => join("results", f))
        : []
      const output = await renderReport(allData, { writtenFiles })
      console.log(output)
      printNotes(allData)
    }
  })

program
  .command("status")
  .description("Show census configuration, probes, backends, and cache status")
  .action(() => {
    const hash = probeHash()

    const probeFiles = readdirSync(join(__dirname, "..", "probes"))
      .filter((f) => f.endsWith(".probe.ts"))
      .sort()

    const resultFiles = existsSync(RESULTS_DIR)
      ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"))
      : []
    const cacheValid = isCacheValid(hash)

    let catalog: ReturnType<typeof loadVersionsCatalog> | null = null
    try {
      catalog = loadVersionsCatalog()
    } catch {}

    const data = loadSavedResults()

    console.log("\n@termless/census\n")
    console.log(`  Probe hash:    ${hash}`)
    console.log(`  Probe files:   ${probeFiles.length} (${probeFiles.join(", ")})`)
    if (data) {
      console.log(`  Features:      ${data.featureIds.length}`)
      console.log(`  Tested:        ${data.backendNames.length} (${data.backendNames.join(", ")})`)
    }

    console.log(`\n  Backends:`)
    for (const name of [...installed, ...available]) {
      const e = entry(name)
      const ready = isReady(name)
      const upstream = e?.upstream ? `${e.upstream}${e.version ? ` ${e.version}` : ""}` : ""
      const status = ready ? "✓" : "✗"
      console.log(`    ${status} ${`${name} (${e?.type ?? "?"})`.padEnd(26)} ${upstream}`)
    }

    console.log(`  Results:       ${resultFiles.length} files in ${shortPath(RESULTS_DIR)}/`)
    console.log(`  Cache:         ${cacheValid ? "valid" : "stale (re-run needed)"}`)

    if (catalog) {
      console.log(`\n  Versions (from versions.json):`)
      for (const [name, config] of Object.entries(catalog.backends)) {
        console.log(`    ${name.padEnd(16)} ${config.versions.join(", ")}`)
      }
    }

    if (data) {
      console.log(`\n  Categories:`)
      for (const [cat, ids] of data.categories) {
        console.log(`    ${cat.padEnd(16)} ${ids.length} features`)
      }
    }

    console.log("")
  })

// ── Default: show help ──

program.action(() => {
  program.help()
})

// ── Helpers ──

function loadSavedResults(): CensusData | null {
  if (!existsSync(RESULTS_DIR)) return null

  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"))
  if (files.length === 0) return null

  const perBackend: Array<{
    backend: string
    version: string
    generated: string
    results: Record<string, boolean>
    notes?: Record<string, string>
  }> = []

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(RESULTS_DIR, file), "utf-8"))
      if (data.backend && data.results) {
        perBackend.push(data)
      }
    } catch {
      log.debug?.(`Failed to parse ${file}`)
    }
  }

  if (perBackend.length === 0) return null

  // Keep only the latest version per backend (by generated timestamp)
  const latest = new Map<string, (typeof perBackend)[0]>()
  for (const e of perBackend) {
    const existing = latest.get(e.backend)
    if (!existing || e.generated > existing.generated) {
      latest.set(e.backend, e)
    }
  }

  return fromPerBackendFiles([...latest.values()])
}

function filterData(data: CensusData, names: Set<string>): CensusData {
  const backendNames = data.backendNames.filter((n) => names.has(n))
  const results = new Map<string, Map<string, boolean>>()
  const notes = new Map<string, Map<string, string>>()
  for (const name of backendNames) {
    results.set(name, data.results.get(name)!)
    notes.set(name, data.notes.get(name) ?? new Map())
  }
  return { backendNames, featureIds: data.featureIds, results, notes, categories: data.categories }
}

function printNotes(data: CensusData) {
  let hasNotes = false
  for (const name of data.backendNames) {
    const backendNotes = data.notes.get(name)
    if (!backendNotes || backendNotes.size === 0) continue
    if (!hasNotes) {
      console.log("\nNotes:\n")
      hasNotes = true
    }
    console.log(`  ${name}:`)
    for (const [feature, note] of backendNotes) {
      console.log(`    ${feature.padEnd(28)} ${note}`)
    }
  }
  if (hasNotes) console.log("")
}

function isCacheValid(currentHash: string): boolean {
  if (!existsSync(RESULTS_DIR)) return false
  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"))
  if (files.length === 0) return false
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(RESULTS_DIR, file), "utf-8"))
      if (data.probeHash !== currentHash) return false
    } catch {
      return false
    }
  }
  return true
}

function shortPath(p: string): string {
  const cwd = process.cwd()
  const home = process.env.HOME ?? ""
  if (p.startsWith(cwd)) return p.slice(cwd.length + 1)
  if (home && p.startsWith(home)) return "~" + p.slice(home.length)
  return p
}

function saveResults(data: CensusData, hash?: string): string[] {
  mkdirSync(RESULTS_DIR, { recursive: true })

  const generated = new Date().toISOString()
  const writtenFiles: string[] = []

  let m: { backends: Record<string, { upstreamVersion: string | null }> } | null = null
  try {
    m = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as typeof m
  } catch {}

  for (const name of data.backendNames) {
    const features = data.results.get(name)!
    const backendNotes = data.notes.get(name)
    const version = m?.backends[name]?.upstreamVersion ?? "latest"
    const filename = `${name}-${version}.json`
    const filepath = join(RESULTS_DIR, filename)

    const perBackend = {
      backend: name,
      version,
      generated,
      ...(hash ? { probeHash: hash } : {}),
      results: Object.fromEntries(features),
      ...(backendNotes && backendNotes.size > 0 ? { notes: Object.fromEntries(backendNotes) } : {}),
    }

    writeFileSync(filepath, JSON.stringify(perBackend, null, 2))
    writtenFiles.push(filepath)
  }

  return writtenFiles
}

await program.parseAsync()
