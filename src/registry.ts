/**
 * Backend registry — discover, resolve, and manage termless backends.
 *
 * Like Playwright's browser management: one manifest controls everything.
 * The backends.json file pins exact versions. Each backend package exports
 * a `resolve()` function that handles its own initialization (WASM loading,
 * native module binding, etc.).
 *
 * @example
 * ```typescript
 * import { resolveBackend, getBackendStatus } from "termless"
 *
 * // Create a backend by name (async — handles WASM init etc.)
 * const backend = await resolveBackend("ghostty")
 * const term = createTerminal({ backend, cols: 80, rows: 24 })
 *
 * // Or use the shorthand
 * const term = await createTerminalByName("ghostty", { cols: 80, rows: 24 })
 *
 * // List all backends with install status
 * const statuses = getBackendStatus()
 * ```
 */

import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { TerminalBackend, TerminalOptions, Terminal } from "./types.ts"
import { createTerminal } from "./terminal.ts"

// ═══════════════════════════════════════════════════════
// Manifest types
// ═══════════════════════════════════════════════════════

export interface BackendManifestEntry {
  package: string
  upstream: string | null
  upstreamVersion: string | null
  description: string
  type: "js" | "wasm" | "native" | "os"
  default: boolean
  requiresBuild?: string
  platforms?: string[]
}

export interface BackendManifest {
  version: string
  backends: Record<string, BackendManifestEntry>
}

// ═══════════════════════════════════════════════════════
// Status types
// ═══════════════════════════════════════════════════════

export interface BackendStatus {
  name: string
  manifest: BackendManifestEntry
  installed: boolean
  installedVersion: string | null
}

export interface BackendHealthResult {
  name: string
  healthy: boolean
  error?: string
  capabilities?: string
}

// ═══════════════════════════════════════════════════════
// Manifest loading
// ═══════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(__dirname, "..", "backends.json")

let cachedManifest: BackendManifest | null = null

export function loadManifest(): BackendManifest {
  if (cachedManifest) return cachedManifest
  const raw = readFileSync(MANIFEST_PATH, "utf-8")
  cachedManifest = JSON.parse(raw)
  return cachedManifest!
}

/** Clear cached manifest (for testing). */
export function _resetManifestCache(): void {
  cachedManifest = null
}

// ═══════════════════════════════════════════════════════
// Installation detection
// ═══════════════════════════════════════════════════════

/**
 * Check if a backend is installed AND usable.
 *
 * For backends without requiresBuild: checks if the npm package resolves.
 * For backends with requiresBuild: also checks if the build artifacts exist
 * by looking for .node files (native) or .js/.wasm files (wasm builds)
 * in the package directory.
 */
export function isBackendInstalled(name: string): boolean {
  const manifest = loadManifest()
  const entry = manifest.backends[name]
  if (!entry) return false

  try {
    const resolved = import.meta.resolve(entry.package)

    // No build step required — package resolution is sufficient
    if (!entry.requiresBuild) return true

    // Has build step — check for build artifacts
    const resolvedPath = fileURLToPath(resolved)
    const pkgDir = findPackageDir(resolvedPath, entry.package)
    if (!pkgDir) return false

    return hasBuildArtifacts(pkgDir, entry.type)
  } catch {
    return false
  }
}

/** Walk up from a resolved path to find the package root. */
function findPackageDir(resolvedPath: string, packageName: string): string | null {
  let dir = dirname(resolvedPath)
  for (let i = 0; i < 10; i++) {
    const pkgJsonPath = join(dir, "package.json")
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"))
        if (pkg.name === packageName) return dir
      } catch {}
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Check if a package has build artifacts (generic — no hardcoded names). */
function hasBuildArtifacts(pkgDir: string, type: string): boolean {
  if (type === "native") {
    // Look for any .node file in the package directory (top-level or native/)
    return globNode(pkgDir)
  }
  if (type === "wasm") {
    // Look for any .wasm file in the package directory
    return globWasm(pkgDir)
  }
  return true
}

function globNode(dir: string): boolean {
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs")
    // Check top-level
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".node")) return true
    }
    // Check build/ and native/ subdirs
    for (const sub of ["build", "native"]) {
      const subDir = join(dir, sub)
      if (existsSync(subDir)) {
        for (const f of readdirSync(subDir)) {
          if (f.endsWith(".node")) return true
        }
      }
    }
  } catch {}
  return false
}

function globWasm(dir: string): boolean {
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs")
    // Check wasm/ and build/ subdirs
    for (const sub of ["wasm", "build"]) {
      const subDir = join(dir, sub)
      if (existsSync(subDir)) {
        for (const f of readdirSync(subDir)) {
          if (f.endsWith(".wasm") || (f.endsWith(".js") && f.includes("wasm"))) return true
        }
      }
    }
  } catch {}
  return false
}

/**
 * Get the installed version of a backend package by reading its package.json.
 */
export function getInstalledVersion(packageName: string): string | null {
  try {
    const resolved = import.meta.resolve(packageName)
    const resolvedPath = fileURLToPath(resolved)
    // Walk up from resolved entry point to find package.json
    let dir = dirname(resolvedPath)
    for (let i = 0; i < 10; i++) {
      const pkgJsonPath = join(dir, "package.json")
      if (existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"))
          if (pkg.name === packageName) return pkg.version ?? null
        } catch {}
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return null
  } catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════
// Backend enumeration
// ═══════════════════════════════════════════════════════

/** All backend names from the manifest. */
export function backendNames(): string[] {
  return Object.keys(loadManifest().backends)
}

/** Backend names marked as default in the manifest. */
export function defaultBackendNames(): string[] {
  const manifest = loadManifest()
  return Object.entries(manifest.backends)
    .filter(([_, e]) => e.default)
    .map(([name]) => name)
}

/** Backend names that are currently installed. */
export function installedBackendNames(): string[] {
  return backendNames().filter(isBackendInstalled)
}

/** Get status of all backends (installed, version, etc.). */
export function getBackendStatus(): BackendStatus[] {
  const manifest = loadManifest()
  return Object.entries(manifest.backends).map(([name, entry]) => {
    const installed = isBackendInstalled(name)
    return {
      name,
      manifest: entry,
      installed,
      installedVersion: installed ? getInstalledVersion(entry.package) : null,
    }
  })
}

// ═══════════════════════════════════════════════════════
// Backend resolution
// ═══════════════════════════════════════════════════════

export interface ResolveOptions extends Partial<TerminalOptions> {
  /**
   * Resolve a specific upstream version of the backend.
   * For JS/WASM backends: installs the specified npm version to a temp dir.
   * For native backends: requires nix or manual build.
   *
   * @example
   * ```typescript
   * const backend = await resolveBackend("xtermjs", { version: "5.4.0" })
   * ```
   */
  version?: string
}

/**
 * Resolve a backend by name. Async because some backends need WASM
 * initialization or native module loading.
 *
 * Each backend package exports a `resolve()` function that handles its own
 * initialization. This keeps per-backend logic in the backend package,
 * not in the registry.
 *
 * Optionally pass `{ version }` to resolve a specific upstream version.
 *
 * @throws If backend is unknown or not installed
 *
 * @example
 * ```typescript
 * const backend = await resolveBackend("ghostty")
 * const backend = await resolveBackend("xtermjs", { version: "5.4.0" })
 * ```
 */
export async function resolveBackend(name: string, opts?: ResolveOptions): Promise<TerminalBackend> {
  const manifest = loadManifest()
  const entry = manifest.backends[name]

  if (!entry) {
    const available = backendNames().join(", ")
    throw new Error(`Unknown backend "${name}". Available backends: ${available}`)
  }

  // Version-pinned resolution: install specific upstream version to temp dir
  if (opts?.version && opts.version !== entry.upstreamVersion) {
    return resolveVersioned(name, entry, opts.version, opts)
  }

  if (!isBackendInstalled(name)) {
    throw new Error(
      `Backend "${name}" is not installed.\n` +
        `Run: bunx termless install ${name}\n` +
        `Or:  npm install -D ${entry.package}`,
    )
  }

  const mod = await import(entry.package)

  // Each backend exports resolve() for self-describing initialization
  if (typeof mod.resolve === "function") {
    return mod.resolve(opts)
  }

  // Fallback: try conventional factory name
  const factoryName = `create${name.charAt(0).toUpperCase() + name.slice(1)}Backend`
  if (typeof mod[factoryName] === "function") {
    return mod[factoryName](opts)
  }

  throw new Error(`Backend "${name}" (${entry.package}) does not export resolve() or ${factoryName}()`)
}

/**
 * Create a Terminal by backend name. Convenience wrapper around
 * resolveBackend + createTerminal.
 *
 * @example
 * ```typescript
 * const term = await createTerminalByName("ghostty", { cols: 120, rows: 40 })
 * term.feed("Hello, world!")
 * ```
 */
export async function createTerminalByName(
  backendName: string,
  opts?: { cols?: number; rows?: number; scrollbackLimit?: number },
): Promise<Terminal> {
  const backend = await resolveBackend(backendName)
  return createTerminal({ backend, ...opts })
}

/**
 * Resolve all installed backends. Returns a map of name → backend.
 * Useful for cross-backend testing.
 *
 * @example
 * ```typescript
 * const all = await resolveAllInstalled()
 * for (const [name, backend] of Object.entries(all)) {
 *   console.log(`${name}: ${backend.capabilities.name}`)
 * }
 * ```
 */
export async function resolveAllInstalled(opts?: Partial<TerminalOptions>): Promise<Record<string, TerminalBackend>> {
  const installed = installedBackendNames()
  const results: Record<string, TerminalBackend> = {}
  for (const name of installed) {
    try {
      results[name] = await resolveBackend(name, opts)
    } catch {
      // Skip backends that fail to resolve (e.g., missing native build)
    }
  }
  return results
}

// ═══════════════════════════════════════════════════════
// Health check
// ═══════════════════════════════════════════════════════

/**
 * Quick health check for a backend: resolve → init → feed → getText → destroy.
 * Returns structured result for CLI display.
 */
export async function checkBackendHealth(name: string): Promise<BackendHealthResult> {
  try {
    const backend = await resolveBackend(name)
    backend.init({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("Hello"))
    const text = backend.getText()
    const caps = backend.capabilities
    backend.destroy()

    if (!text.includes("Hello")) {
      return {
        name,
        healthy: false,
        error: `feed/getText round-trip failed (got: "${text.trim()}")`,
      }
    }

    return {
      name,
      healthy: true,
      capabilities: `${caps.name} (truecolor: ${caps.truecolor}, kitty: ${caps.kittyKeyboard})`,
    }
  } catch (e) {
    return {
      name,
      healthy: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Run health checks on all installed backends.
 */
export async function checkAllHealth(): Promise<BackendHealthResult[]> {
  const installed = installedBackendNames()
  return Promise.all(installed.map(checkBackendHealth))
}

// ═══════════════════════════════════════════════════════
// Install helpers (for CLI)
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// Versioned resolution
// ═══════════════════════════════════════════════════════

const VERSION_CACHE_DIR = join(__dirname, "..", ".termless-cache", "versions")

/**
 * Resolve a specific version of a backend by installing its upstream
 * dependency to a cached temp directory.
 *
 * Only works for JS/WASM backends (npm packages). Native backends
 * require nix or manual builds.
 */
async function resolveVersioned(
  name: string,
  entry: BackendManifestEntry,
  version: string,
  opts?: Partial<TerminalOptions>,
): Promise<TerminalBackend> {
  if (entry.type === "native") {
    throw new Error(
      `Version-pinned resolution for native backend "${name}" requires nix.\n` +
        `Run: nix develop .#${name}-${version.replace(/\./g, "_")} --command bun census --backend ${name}`,
    )
  }

  if (!entry.upstream) {
    throw new Error(`Backend "${name}" has no upstream package to version-pin.`)
  }

  // Cache dir per backend+version
  const cacheDir = join(VERSION_CACHE_DIR, `${name}-${version}`)
  const upstreamPkg = entry.upstream

  // Install upstream to cache dir if not already there
  if (!existsSync(join(cacheDir, "node_modules", upstreamPkg))) {
    const { mkdirSync } = await import("node:fs")
    const { execSync } = await import("node:child_process")
    mkdirSync(cacheDir, { recursive: true })

    // Create a minimal package.json
    const pkgJson = JSON.stringify({
      name: `termless-cache-${name}-${version}`,
      private: true,
      dependencies: { [upstreamPkg]: version },
    })
    const { writeFileSync } = await import("node:fs")
    writeFileSync(join(cacheDir, "package.json"), pkgJson)

    // Install
    execSync("bun install --no-save", { cwd: cacheDir, stdio: "pipe" })
  }

  // Now we need the backend wrapper to use this specific upstream version.
  // The backend's resolve() function uses whatever upstream is in node_modules.
  // We temporarily prepend our cache dir to NODE_PATH so the import resolves there.
  //
  // For now, this only works for backends whose upstream is a single npm package.
  // The backend's own code (e.g., @termless/xtermjs/src/backend.ts) imports
  // from the upstream package name, and we redirect that import.

  // Store original and set cache path
  const origNodePath = process.env.NODE_PATH
  process.env.NODE_PATH = join(cacheDir, "node_modules") + (origNodePath ? `:${origNodePath}` : "")

  try {
    // Clear module cache for the upstream package so it re-resolves
    // (This is best-effort — ESM module cache can't be fully cleared)

    // Re-import the backend module (will pick up the versioned upstream)
    const mod = await import(entry.package)
    if (typeof mod.resolve === "function") {
      return mod.resolve(opts)
    }
    throw new Error(`Backend "${name}" does not export resolve()`)
  } finally {
    // Restore NODE_PATH
    if (origNodePath) process.env.NODE_PATH = origNodePath
    else delete process.env.NODE_PATH
  }
}

// ═══════════════════════════════════════════════════════
// Install helpers (for CLI)
// ═══════════════════════════════════════════════════════

/**
 * Get the npm install command for a set of backends.
 * Used by the CLI install command.
 */
export function getInstallCommand(names: string[], packageManager: "npm" | "bun" | "pnpm" | "yarn" = "npm"): string {
  const manifest = loadManifest()
  const packages = names
    .map((name) => {
      const entry = manifest.backends[name]
      if (!entry) throw new Error(`Unknown backend: ${name}`)
      return `${entry.package}@${manifest.version}`
    })
    .join(" ")

  const cmd = packageManager === "npm" ? "install -D" : "add -D"
  return `${packageManager} ${cmd} ${packages}`
}

/**
 * Detect which package manager is being used in the current project.
 */
export function detectPackageManager(): "npm" | "bun" | "pnpm" | "yarn" {
  const cwd = process.cwd()
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun"
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn"
  return "npm"
}
