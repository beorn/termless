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
 * Check if a backend package is importable.
 * Uses import.meta.resolve which checks module resolution without loading.
 */
export function isBackendInstalled(name: string): boolean {
  const manifest = loadManifest()
  const entry = manifest.backends[name]
  if (!entry) return false
  try {
    import.meta.resolve(entry.package)
    return true
  } catch {
    return false
  }
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

/**
 * Resolve a backend by name. Async because some backends need WASM
 * initialization or native module loading.
 *
 * Each backend package exports a `resolve()` function that handles its own
 * initialization. This keeps per-backend logic in the backend package,
 * not in the registry.
 *
 * @throws If backend is unknown or not installed
 *
 * @example
 * ```typescript
 * const backend = await resolveBackend("ghostty")
 * const term = createTerminal({ backend })
 * ```
 */
export async function resolveBackend(name: string, opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  const manifest = loadManifest()
  const entry = manifest.backends[name]

  if (!entry) {
    const available = backendNames().join(", ")
    throw new Error(`Unknown backend "${name}". Available backends: ${available}`)
  }

  if (!isBackendInstalled(name)) {
    throw new Error(
      `Backend "${name}" is not installed.\n` +
        `Run: npx termless install ${name}\n` +
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
