#!/usr/bin/env bun
/**
 * Census CLI — terminal capability census with silvery output.
 *
 * @example
 * ```bash
 * bun census run           # Execute probes, show matrix, save results
 * bun census report        # Display last saved results
 * bun census list          # List probe categories with counts
 * ```
 */

import { Command } from "commander"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createLogger } from "loggily"
import { parseVitestJson, fromSavedJson, toSavedJson } from "./parse.ts"
import { renderReport } from "./report.tsx"

const log = createLogger("census")

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..", "..", "..")
const RESULTS_DIR = join(__dirname, "..", "results")
const CURRENT_JSON = join(RESULTS_DIR, "current.json")
const MANIFEST_PATH = join(ROOT, "backends.json")

// ── Commands ──

const program = new Command()
  .name("census")
  .description("Terminal capability census — probe features across all backends")

program
  .command("run")
  .description("Execute probes via vitest, show matrix, save results")
  .action(async () => {
    log.debug?.("Spawning vitest with census config")

    const proc = Bun.spawn(
      ["bun", "vitest", "run", "--config", "vitest.census.ts", "--reporter", "json"],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    await proc.exited

    if (stderr) {
      // vitest sends progress to stderr — only log if debug
      log.debug?.("vitest stderr: %s", stderr.slice(0, 500))
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
      log.debug?.("Raw output (first 500 chars): %s", stdout.slice(0, 500))
      process.exit(1)
    }

    const data = parseVitestJson(json)

    if (data.backendNames.length === 0) {
      console.error("Error: no backend results found in vitest output")
      process.exit(1)
    }

    log.debug?.("Parsed %d backends, %d features", data.backendNames.length, data.featureIds.length)

    // Save results
    const writtenFiles = saveResults(data)

    // Render
    const output = await renderReport(data, { writtenFiles })
    console.log(output)
  })

program
  .command("report")
  .description("Display last saved census results")
  .action(async () => {
    if (!existsSync(CURRENT_JSON)) {
      console.error("No saved results. Run: bun census run")
      process.exit(1)
    }

    const saved = JSON.parse(readFileSync(CURRENT_JSON, "utf-8"))
    const data = fromSavedJson(saved)

    log.debug?.("Loaded %d backends, %d features from %s", data.backendNames.length, data.featureIds.length, saved.generated)

    const output = await renderReport(data)
    console.log(output)
  })

program
  .command("list")
  .description("List probe categories with feature counts")
  .action(async () => {
    if (!existsSync(CURRENT_JSON)) {
      console.error("No saved results. Run: bun census run")
      process.exit(1)
    }

    const saved = JSON.parse(readFileSync(CURRENT_JSON, "utf-8"))
    const data = fromSavedJson(saved)

    console.log("\nProbe categories:\n")
    for (const [cat, ids] of data.categories) {
      console.log(`  ${cat.padEnd(20)} ${ids.length} features`)
    }
    console.log(`\n  Total: ${data.featureIds.length} features across ${data.backendNames.length} backends\n`)
  })

// ── Default: run if no subcommand ──

program.action(async () => {
  // Default to "run" when called without subcommand
  await program.parseAsync(["node", "census", "run"])
})

// ── Helpers ──

function saveResults(data: ReturnType<typeof parseVitestJson>): string[] {
  mkdirSync(RESULTS_DIR, { recursive: true })

  const output = toSavedJson(data)
  writeFileSync(CURRENT_JSON, JSON.stringify(output, null, 2))

  const writtenFiles = [CURRENT_JSON]

  // Per-backend result files with upstream versions
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
      generated: output.generated,
      results: Object.fromEntries(features),
      ...(backendNotes && backendNotes.size > 0 ? { notes: Object.fromEntries(backendNotes) } : {}),
    }

    writeFileSync(filepath, JSON.stringify(perBackend, null, 2))
    writtenFiles.push(filepath)
  }

  log.debug?.("Saved %d result files", writtenFiles.length)
  return writtenFiles
}

await program.parseAsync()
