/**
 * Versioned census — run probes against older upstream versions of backends.
 *
 * For each backend+version pair in versions.json:
 * 1. Install the upstream package at that version to a cache directory
 * 2. Run vitest probes in a subprocess with NODE_PATH pointing to the cached version
 * 3. Parse results and save as {backend}-{version}.json
 * 4. Skip if result already exists and probe files haven't changed (hash match)
 *
 * Only JS/WASM backends are supported — native backends require building from source.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import { createLogger } from "loggily"
import { parseVitestJson } from "./parse.ts"

const log = createLogger("census")

const __dirname = dirname(fileURLToPath(import.meta.url))
const CENSUS_ROOT = join(__dirname, "..")
const TERMLESS_ROOT = join(CENSUS_ROOT, "..", "..")
const RESULTS_DIR = join(CENSUS_ROOT, "results")
const PROBES_DIR = join(CENSUS_ROOT, "probes")
const VERSIONS_PATH = join(CENSUS_ROOT, "versions.json")
const CACHE_DIR = join(TERMLESS_ROOT, ".termless-cache", "census-versions")

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

/**
 * Install an upstream package at a specific version to the cache directory.
 * Returns the path to the node_modules directory.
 */
function ensureVersionInstalled(upstream: string, version: string): string {
  const cacheDir = join(CACHE_DIR, `${upstream.replace(/[/@]/g, "_")}-${version}`)
  const nodeModules = join(cacheDir, "node_modules")

  if (existsSync(nodeModules)) {
    log.debug?.(`Cache hit: ${upstream}@${version}`)
    return nodeModules
  }

  log.debug?.(`Installing ${upstream}@${version} to ${cacheDir}`)
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(
    join(cacheDir, "package.json"),
    JSON.stringify({ private: true, dependencies: { [upstream]: version } }),
  )

  try {
    execSync("bun install --no-save", { cwd: cacheDir, stdio: "pipe" })
  } catch (e: any) {
    throw new Error(`Failed to install ${upstream}@${version}: ${e.message}`)
  }

  return nodeModules
}

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

// ── Run probes for a single backend+version ──

/**
 * Run census probes for a specific backend at a specific upstream version.
 *
 * Strategy: run vitest in a subprocess with NODE_PATH set so the upstream
 * package resolves from our cached version instead of workspace node_modules.
 * The `--reporter json` flag gives us structured output to parse.
 *
 * We filter vitest to only run probes for the specific backend by using
 * a custom environment variable that _backends.ts can check.
 */
function runProbesForVersion(
  backendName: string,
  upstream: string,
  version: string,
  nodeModulesPath: string,
): ReturnType<typeof parseVitestJson> | null {
  log.debug?.(`Running probes: ${backendName}@${version}`)

  // Build NODE_PATH: our versioned cache first, then existing paths
  const existingNodePath = process.env.NODE_PATH ?? ""
  const nodePath = nodeModulesPath + (existingNodePath ? `:${existingNodePath}` : "")

  try {
    const result = execSync(
      [
        "bun",
        "vitest",
        "run",
        "--config",
        "vitest.census.ts",
        "--reporter",
        "json",
      ].join(" "),
      {
        cwd: TERMLESS_ROOT,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_PATH: nodePath,
          CENSUS_BACKEND: backendName,
        },
        timeout: 120_000,
      },
    )

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
  }
}

// ── Main entry point ──

export interface VersionsRunOptions {
  /** Only run specific backends (default: all in catalog) */
  backends?: string[]
  /** Force re-run even if cache is valid */
  force?: boolean
}

/**
 * Run versioned census — probes against older versions of backends.
 */
export async function runVersionedCensus(opts?: VersionsRunOptions): Promise<VersionRunResult[]> {
  const catalog = loadVersionsCatalog()
  const hash = probeHash()
  const results: VersionRunResult[] = []

  mkdirSync(RESULTS_DIR, { recursive: true })

  const backendFilter = opts?.backends
    ? new Set(opts.backends)
    : new Set(Object.keys(catalog.backends))

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
      let nodeModulesPath: string
      try {
        nodeModulesPath = ensureVersionInstalled(config.upstream, version)
      } catch (e: any) {
        results.push({ backend: backendName, version, skipped: false, error: e.message })
        continue
      }

      // Run probes
      const data = runProbesForVersion(backendName, config.upstream, version, nodeModulesPath)

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
