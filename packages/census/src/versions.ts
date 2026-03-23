/**
 * Versioned census — run probes against older upstream versions of backends.
 *
 * For each backend+version pair in versions.json:
 * 1. Install the upstream package at that version to a cache directory
 * 2. Generate a vitest config with `resolve.alias` to redirect the upstream import
 * 3. Run vitest probes in a subprocess, parsing JSON output
 * 4. Save results as {backend}-{version}.json
 * 5. Skip if result already exists and probe files haven't changed (hash match)
 *
 * Uses Vite's `resolve.alias` rather than NODE_PATH because Bun's module
 * resolution ignores NODE_PATH when the package is already available in
 * the workspace node_modules. The alias approach intercepts at the bundler
 * level before Bun's resolver runs.
 *
 * Only JS/WASM backends are supported — native backends require building
 * each version from source (deferred).
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import { createLogger } from "loggily"
import { parseVitestJson } from "./parse.ts"
import { ensureCachedVersion } from "@termless/core"

const log = createLogger("census")

const __dirname = dirname(fileURLToPath(import.meta.url))
const CENSUS_ROOT = join(__dirname, "..")
const TERMLESS_ROOT = join(CENSUS_ROOT, "..", "..")
const RESULTS_DIR = join(CENSUS_ROOT, "results")
const PROBES_DIR = join(CENSUS_ROOT, "probes")
const VERSIONS_PATH = join(CENSUS_ROOT, "versions.json")
// Cache dir handled by ensureCachedVersion() in backends.ts

// ── Types ──

interface VersionsCatalog {
  backends: Record<
    string,
    {
      upstream: string
      versions: string[]
    }
  >
}

interface VersionRunResult {
  backend: string
  version: string
  skipped: boolean
  featureCount?: number
  passCount?: number
  error?: string
}

// ── Probe hash ──

/**
 * Compute a hash of all probe files + the _backends.ts infrastructure.
 * Used as cache key — if probes haven't changed, skip re-running.
 */
export function probeHash(): string {
  const hash = createHash("md5")

  // Hash all probe files
  const probeFiles = readdirSync(PROBES_DIR)
    .filter((f) => f.endsWith(".probe.ts"))
    .sort()
  for (const f of probeFiles) {
    hash.update(readFileSync(join(PROBES_DIR, f)))
  }

  // Hash the backends infrastructure (changes here affect results)
  const backendsFile = join(PROBES_DIR, "_backends.ts")
  if (existsSync(backendsFile)) {
    hash.update(readFileSync(backendsFile))
  }

  return hash.digest("hex").slice(0, 12)
}

// ── Version catalog ──

export function loadVersionsCatalog(): VersionsCatalog {
  if (!existsSync(VERSIONS_PATH)) {
    throw new Error(`Versions catalog not found: ${VERSIONS_PATH}`)
  }
  return JSON.parse(readFileSync(VERSIONS_PATH, "utf-8")) as VersionsCatalog
}

// ── Cache management ──

// Version installation delegated to ensureCachedVersion() from backends.ts

/**
 * Check if a cached result is still valid (probe hash matches).
 */
function isCacheValid(resultPath: string, currentHash: string): boolean {
  if (!existsSync(resultPath)) return false

  try {
    const data = JSON.parse(readFileSync(resultPath, "utf-8"))
    return data.probeHash === currentHash
  } catch {
    return false
  }
}

/**
 * Resolve the path to the upstream package entry point within a cache dir.
 * For scoped packages like @xterm/headless, walk node_modules/@xterm/headless.
 */
function resolveUpstreamPath(cacheDir: string, upstream: string): string {
  const nodeModules = join(cacheDir, "node_modules")
  const pkgDir = join(nodeModules, ...upstream.split("/"))

  if (!existsSync(pkgDir)) {
    throw new Error(`Package ${upstream} not found in ${nodeModules}`)
  }

  // Read package.json to find the entry point
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"))
  const entry = pkgJson.module ?? pkgJson.main ?? "index.js"
  const entryPath = join(pkgDir, entry)

  if (existsSync(entryPath)) return entryPath

  // Fallback: just return the package directory (Vite will resolve from there)
  return pkgDir
}

// ── Run probes for a single backend+version ──

/**
 * Generate a temporary vitest config that uses resolve.alias to redirect
 * the upstream package import to the cached version.
 */
function generateVersionedConfig(upstream: string, aliasTarget: string): string {
  // Escape backslashes for the path in the generated JS
  const escapedTarget = aliasTarget.replace(/\\/g, "\\\\")

  return `
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "${upstream}": "${escapedTarget}",
    },
  },
  test: {
    include: ["packages/census/probes/**/*.probe.ts"],
  },
})
`.trim()
}

/**
 * Run census probes for a specific backend at a specific upstream version.
 *
 * Strategy: generate a vitest config with `resolve.alias` that redirects the
 * upstream package import (e.g., @xterm/headless) to a cached version.
 * All backends load; we extract only the target backend's results.
 */
function runProbesForVersion(
  backendName: string,
  upstream: string,
  version: string,
  cacheDir: string,
): ReturnType<typeof parseVitestJson> | null {
  log.debug?.(`Running probes: ${backendName}@${version}`)

  // Resolve the cached upstream package path
  let aliasTarget: string
  try {
    aliasTarget = resolveUpstreamPath(cacheDir, upstream)
  } catch (e: any) {
    log.debug?.(`Failed to resolve upstream path: ${e.message}`)
    return null
  }

  // Generate temporary vitest config
  const configContent = generateVersionedConfig(upstream, aliasTarget)
  const configPath = join(TERMLESS_ROOT, `.vitest.census-${backendName}-${version.replace(/\./g, "_")}.ts`)

  try {
    writeFileSync(configPath, configContent)

    const result = execSync(["bun", "vitest", "run", "--config", configPath, "--reporter", "json"].join(" "), {
      cwd: TERMLESS_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      timeout: 120_000,
    })

    const stdout = result.toString("utf-8")
    if (!stdout.trim()) {
      log.debug?.(`No output from vitest for ${backendName}@${version}`)
      return null
    }

    const json = JSON.parse(stdout)
    return parseVitestJson(json)
  } catch (e: any) {
    // vitest exits with non-zero when tests fail — that's expected for census
    // Try to parse stdout from the error
    if (e.stdout) {
      try {
        const stdout = e.stdout.toString("utf-8")
        const json = JSON.parse(stdout)
        return parseVitestJson(json)
      } catch {
        // Fall through
      }
    }
    log.debug?.(`Error running probes for ${backendName}@${version}: ${e.message}`)
    return null
  } finally {
    // Clean up temporary config
    try {
      unlinkSync(configPath)
    } catch {}
  }
}

// ── Main entry point ──

export interface VersionsRunOptions {
  /** Only run specific backends (default: all in catalog) */
  backends?: string[]
  /** Force re-run even if cache is valid */
  force?: boolean
  /** Results directory (default: packages/census/results) */
  resultsDir?: string
}

/**
 * Run versioned census — probes against older versions of backends.
 */
export async function runVersionedCensus(opts?: VersionsRunOptions): Promise<VersionRunResult[]> {
  const catalog = loadVersionsCatalog()
  const hash = probeHash()
  const results: VersionRunResult[] = []

  mkdirSync(RESULTS_DIR, { recursive: true })

  const backendFilter = opts?.backends ? new Set(opts.backends) : new Set(Object.keys(catalog.backends))

  for (const [backendName, config] of Object.entries(catalog.backends)) {
    if (!backendFilter.has(backendName)) continue

    for (const version of config.versions) {
      const filename = `${backendName}-${version}.json`
      const resultPath = join(RESULTS_DIR, filename)

      // Check cache
      if (!opts?.force && isCacheValid(resultPath, hash)) {
        log.debug?.(`Skipping ${backendName}@${version} (cache valid, hash=${hash})`)
        results.push({ backend: backendName, version, skipped: true })
        continue
      }

      // Install upstream at version
      let cacheDir: string
      try {
        cacheDir = ensureCachedVersion(config.upstream, version)
      } catch (e: any) {
        results.push({ backend: backendName, version, skipped: false, error: e.message })
        continue
      }

      // Run probes
      const data = runProbesForVersion(backendName, config.upstream, version, cacheDir)

      if (!data || data.backendNames.length === 0) {
        results.push({
          backend: backendName,
          version,
          skipped: false,
          error: "No results from vitest",
        })
        continue
      }

      // Extract results for this backend only
      const backendResults = data.results.get(backendName)
      const backendNotes = data.notes.get(backendName)

      if (!backendResults) {
        results.push({
          backend: backendName,
          version,
          skipped: false,
          error: `Backend "${backendName}" not found in vitest output`,
        })
        continue
      }

      // Save result file
      let passCount = 0
      for (const r of backendResults.values()) {
        if (r) passCount++
      }

      const perBackend = {
        backend: backendName,
        version,
        probeHash: hash,
        generated: new Date().toISOString(),
        results: Object.fromEntries(backendResults),
        ...(backendNotes && backendNotes.size > 0 ? { notes: Object.fromEntries(backendNotes) } : {}),
      }

      writeFileSync(resultPath, JSON.stringify(perBackend, null, 2))
      log.debug?.(`Saved ${resultPath}`)

      results.push({
        backend: backendName,
        version,
        skipped: false,
        featureCount: backendResults.size,
        passCount,
      })
    }
  }

  return results
}
