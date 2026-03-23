#!/usr/bin/env bun
/**
 * Census CLI — terminal capability census with silvery output.
 *
 * @example
 * ```bash
 * bun census report          # Run probes + show matrix (cached if unchanged)
 * bun census report --force  # Re-run all probes
 * bun census report --cached # Show saved results without re-running
 * bun census list            # List probe categories with counts
 * ```
 */

import { Command } from "commander"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createLogger } from "loggily"
import { parseVitestJson, fromPerBackendFiles } from "./parse.ts"
import { manifest, backends as allBackendNames, isReady } from "../../../src/backends.ts"
import { renderReport } from "./report.tsx"
import { runVersionedCensus, probeHash, loadVersionsCatalog } from "./versions.ts"

const log = createLogger("census")

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..", "..", "..")
const RESULTS_DIR = join(__dirname, "..", "results")
const MANIFEST_PATH = join(ROOT, "backends.json")

// ── Commands ──

const installed = allBackendNames().filter(isReady)
const available = allBackendNames().filter((n) => !isReady(n))

const program = new Command()
  .name("census")
  .description(
    `Terminal capability census — probe features across all backends

Examples:
  bun census report            Run probes + show matrix (cached if unchanged)
  bun census report --force    Re-run all probes
  bun census report --cached   Show saved results without re-running
  bun census versions          Test older upstream versions
  bun census status            Show config, probes, cache status

Backends (${installed.length} installed): ${installed.join(", ")}${available.length > 0 ? `\nAvailable: ${available.join(", ")}` : ""}`,
  )

program
  .command("report")
  .description("Run probes and show capability matrix")
  .option("-f, --force", "Re-run probes even if cached results are valid")
  .option("--cached", "Show saved results without re-running probes")
  .action(async (opts: { force?: boolean; cached?: boolean }) => {
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

    const hash = probeHash()

    // Check cache — skip if results exist and probe hash matches
    if (!opts.force) {
      const cached = loadSavedResults()
      if (cached && isCacheValid(hash)) {
        console.log(`\nCensus results are up to date (probe hash: ${hash}). Use --force to re-run.\n`)
        const output = await renderReport(cached)
        console.log(output)
        printNotes(cached)
        return
      }
    }

    log.debug?.("Spawning vitest with census config")
    console.log(`\nRunning census probes (hash: ${hash})...\n`)

    const proc = Bun.spawn(["bun", "vitest", "run", "--config", "vitest.census.ts", "--reporter", "json"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    await proc.exited

    if (stderr) {
      log.debug?.(`vitest stderr: ${stderr.slice(0, 500)}`)
    }

    if (!stdout.trim()) {
      console.error("Error: vitest produced no JSON output")
      process.exit(1)
    }

    let json: any
    try {
      json = JSON.parse(stdout)
    } catch {
      console.error("Error: failed to parse vitest JSON output")
      log.debug?.(`Raw output (first 500 chars): ${stdout.slice(0, 500)}`)
      process.exit(1)
    }

    const data = parseVitestJson(json)

    if (data.backendNames.length === 0) {
      console.error("Error: no backend results found in vitest output")
      process.exit(1)
    }

    log.debug?.(`Parsed ${data.backendNames.length} backends, ${data.featureIds.length} features`)

    // Save per-backend result files (with probe hash for cache validation)
    const writtenFiles = saveResults(data, hash)

    // Render
    const output = await renderReport(data, { writtenFiles: writtenFiles.map(shortPath) })
    console.log(output)
    printNotes(data)
  })

program
  .command("status")
  .description("Show census configuration, probes, backends, and cache status")
  .action(() => {
    const hash = probeHash()

    // Probe files
    const probeFiles = readdirSync(join(__dirname, "..", "probes"))
      .filter((f) => f.endsWith(".probe.ts"))
      .sort()
    const probeCount = probeFiles.length

    // Results
    const resultFiles = existsSync(RESULTS_DIR)
      ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"))
      : []
    const cacheValid = isCacheValid(hash)

    // Versions catalog
    let versionPairs = 0
    try {
      const catalog = loadVersionsCatalog()
      for (const config of Object.values(catalog.backends)) {
        versionPairs += config.versions.length
      }
    } catch {}

    // Categories from saved results
    const data = loadSavedResults()

    console.log("\n@termless/census\n")
    console.log(`  Probe hash:    ${hash}`)
    console.log(`  Probe files:   ${probeCount} (${probeFiles.join(", ")})`)
    if (data) {
      console.log(`  Features:      ${data.featureIds.length}`)
      console.log(`  Tested:        ${data.backendNames.length} (${data.backendNames.join(", ")})`)
    }
    console.log(`  Installed:     ${installed.length} (${installed.join(", ")})`)
    if (available.length > 0) {
      console.log(`  Available:     ${available.length} (${available.join(", ")})`)
    }
    console.log(`  Results:       ${resultFiles.length} files in ${shortPath(RESULTS_DIR)}/`)
    console.log(`  Cache:         ${cacheValid ? "valid" : "stale (re-run needed)"}`)
    if (versionPairs > 0) {
      console.log(`  Version pairs: ${versionPairs}`)
    }

    if (data) {
      console.log("\n  Categories:")
      for (const [cat, ids] of data.categories) {
        console.log(`    ${cat.padEnd(20)} ${ids.length} features`)
      }
    }

    console.log("")
  })

program
  .command("versions")
  .description("Run probes against older upstream versions (from versions.json)")
  .option("-f, --force", "Force re-run even if cached results are valid")
  .option("-b, --backend <name>", "Only run a specific backend")
  .action(async (opts: { force?: boolean; backend?: string }) => {
    const catalog = loadVersionsCatalog()
    const hash = probeHash()

    const pairs: string[] = []
    for (const [name, config] of Object.entries(catalog.backends)) {
      if (opts.backend && name !== opts.backend) continue
      for (const version of config.versions) {
        pairs.push(`${name}@${version}`)
      }
    }
    console.log(`\nVersioned census: ${pairs.length} backend-version pairs`)
    console.log(`  Probe hash: ${hash}`)
    console.log(`  Pairs: ${pairs.join(", ")}\n`)

    const results = await runVersionedCensus({
      backends: opts.backend ? [opts.backend] : undefined,
      force: opts.force,
    })

    for (const r of results) {
      if (r.skipped) {
        console.log(`  ${r.backend}@${r.version} — skipped (cached)`)
      } else if (r.error) {
        console.log(`  ${r.backend}@${r.version} — error: ${r.error}`)
      } else {
        const pct = Math.round(((r.passCount ?? 0) / (r.featureCount || 1)) * 100)
        console.log(`  ${r.backend}@${r.version} — ${r.passCount}/${r.featureCount} (${pct}%)`)
      }
    }

    const ran = results.filter((r) => !r.skipped && !r.error).length
    const skipped = results.filter((r) => r.skipped).length
    const errors = results.filter((r) => r.error).length
    console.log(`\n  Done: ${ran} ran, ${skipped} cached, ${errors} errors\n`)
  })

// ── Default: show help ──

program.action(() => {
  program.help()
})

// ── Helpers ──

function loadSavedResults() {
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
  for (const entry of perBackend) {
    const existing = latest.get(entry.backend)
    if (!existing || entry.generated > existing.generated) {
      latest.set(entry.backend, entry)
    }
  }

  return fromPerBackendFiles([...latest.values()])
}

/** Print failure notes for all backends. */
function printNotes(data: ReturnType<typeof parseVitestJson>) {
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

/** Check if all cached results have the current probe hash. */
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

/** Shorten a path for display: relative to CWD, or ~/... */
function shortPath(p: string): string {
  const cwd = process.cwd()
  const home = process.env.HOME ?? ""
  if (p.startsWith(cwd)) return p.slice(cwd.length + 1)
  if (home && p.startsWith(home)) return "~" + p.slice(home.length)
  return p
}

function saveResults(data: ReturnType<typeof parseVitestJson>, hash?: string): string[] {
  mkdirSync(RESULTS_DIR, { recursive: true })

  const generated = new Date().toISOString()
  const writtenFiles: string[] = []

  // Read manifest for upstream versions
  let manifest: { backends: Record<string, { upstreamVersion: string | null }> } | null = null
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as typeof manifest
  } catch {
    // Fall back to "latest"
  }

  for (const name of data.backendNames) {
    const features = data.results.get(name)!
    const backendNotes = data.notes.get(name)
    const version = manifest?.backends[name]?.upstreamVersion ?? "latest"
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

  log.debug?.(`Saved ${writtenFiles.length} result files`)
  return writtenFiles
}

await program.parseAsync()
