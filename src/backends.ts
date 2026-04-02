/**
 * Backend registry — one function, everything derived.
 *
 * @example
 * ```typescript
 * import { backend } from "termless"
 *
 * const b = await backend("ghostty")
 * const b = await backend("xtermjs", { version: "5.4.0" })
 * ```
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import type { TerminalBackend, TerminalOptions, Terminal } from "./types.ts"
import { createTerminal } from "./terminal.ts"

// ═══════════════════════════════════════════════════════
// Manifest
// ═══════════════════════════════════════════════════════

export interface BackendEntry {
  package: string
  upstream: string | null
  version: string | null
  type: "js" | "wasm" | "native" | "os"
  default?: boolean
  platforms?: string[]
  label?: string
  description?: string
  url?: string
  caveat?: string
  slug?: string
  terminal?: {
    name: string
    description: string
    body?: string
    url?: string
    repo?: string
    author?: string
  }
}

export interface Manifest {
  version: string
  backends: Record<string, BackendEntry>
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(__dirname, "..", "backends.json")

let _manifest: Manifest | null = null

export function manifest(): Manifest {
  if (_manifest) return _manifest
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as any
  // Normalize: map upstreamVersion → version for cleaner access
  const backends: Record<string, BackendEntry> = {}
  for (const [name, entry] of Object.entries(raw.backends) as [string, any][]) {
    backends[name] = {
      package: entry.package,
      upstream: entry.upstream ?? null,
      version: entry.upstreamVersion ?? null,
      type: entry.type,
      default: entry.default,
      platforms: entry.platforms,
      label: entry.label,
      description: entry.description,
      url: entry.url,
      caveat: entry.caveat,
      slug: entry.slug,
      terminal: entry.terminal,
    }
  }
  _manifest = { version: raw.version, backends }
  return _manifest
}

// ═══════════════════════════════════════════════════════
// Backend types — polymorphic on js/wasm/native/os
// ═══════════════════════════════════════════════════════

interface BackendType {
  /** Check if the backend is built and ready to use. */
  isReady(pkgDir: string): boolean
  /** Build the backend from source. No-op if already ready. */
  build(pkgDir: string): void
  /** Resolve (import + initialize) the backend. */
  resolve(packageName: string, opts?: Partial<TerminalOptions>): Promise<TerminalBackend>
}

function hasFilesWithExt(dir: string, ext: string, subdirs: string[] = []): boolean {
  const dirs = [dir, ...subdirs.map((s) => join(dir, s))]
  for (const d of dirs) {
    if (!existsSync(d)) continue
    try {
      for (const f of readdirSync(d)) {
        if (f.endsWith(ext)) return true
      }
    } catch {}
  }
  return false
}

function resolveModule(pkg: string, opts?: Partial<TerminalOptions>) {
  return async () => {
    const mod = await import(pkg)
    return typeof mod.resolve === "function"
      ? mod.resolve(opts)
      : mod[Object.keys(mod).find((k) => k.startsWith("create"))!](opts)
  }
}

/** Run a backend's build/build.sh, falling back to nix if tools aren't in PATH. */
function runBuildScript(pkgDir: string): void {
  const buildScript = join(pkgDir, "build", "build.sh")
  if (!existsSync(buildScript)) return
  console.log(`  Building in ${pkgDir}...`)
  try {
    execSync(`bash build/build.sh`, { cwd: pkgDir, stdio: "inherit" })
  } catch {
    const flakeDir = join(__dirname, "..")
    if (existsSync(join(flakeDir, "flake.nix"))) {
      execSync(`nix develop ${flakeDir} --command bash build/build.sh`, { cwd: pkgDir, stdio: "inherit" })
    } else {
      throw new Error(`Build failed. Install dependencies or use the nix flake: nix develop`)
    }
  }
}

const backendTypes: Record<string, BackendType> = {
  js: {
    isReady: () => true,
    build: () => {},
    resolve: async (pkg, opts) => resolveModule(pkg, opts)(),
  },

  wasm: {
    isReady: (pkgDir) => {
      // WASM backends distributed via npm are ready immediately (wasm bundled in package).
      // WASM backends built from source need a .wasm file.
      return hasFilesWithExt(pkgDir, ".wasm", ["wasm", "build"]) || !existsSync(join(pkgDir, "build"))
    },
    build: (pkgDir) => runBuildScript(pkgDir),
    resolve: async (pkg, opts) => resolveModule(pkg, opts)(),
  },

  native: {
    isReady: (pkgDir) => hasFilesWithExt(pkgDir, ".node", ["build", "native"]),
    build: (pkgDir) => runBuildScript(pkgDir),
    resolve: async (pkg, opts) => resolveModule(pkg, opts)(),
  },

  os: {
    isReady: () => true,
    build: () => {},
    resolve: async (pkg, opts) => resolveModule(pkg, opts)(),
  },
}

// ═══════════════════════════════════════════════════════
// Build
// ═══════════════════════════════════════════════════════

/** Build a backend's native artifacts if not already ready. */
export function buildBackend(name: string): void {
  const m = manifest()
  const e = m.backends[name]
  if (!e) throw new Error(`Unknown backend: ${name}`)

  const type = backendTypes[e.type]
  if (!type) return

  const pkgDir = findPackageDir(e.package)
  if (!pkgDir) return

  if (!type.isReady(pkgDir)) {
    type.build(pkgDir)
  }
}

// ═══════════════════════════════════════════════════════
// Core API
// ═══════════════════════════════════════════════════════

/**
 * Resolve a backend by name. The one function you need.
 *
 * @example
 * ```typescript
 * const b = await backend("ghostty")
 * const b = await backend("xtermjs", { version: "5.4.0" })
 * ```
 */
export async function backend(
  name: string,
  opts?: Partial<TerminalOptions> & { version?: string },
): Promise<TerminalBackend> {
  const m = manifest()
  const entry = m.backends[name]

  if (!entry) {
    throw new Error(`Unknown backend "${name}". Available: ${Object.keys(m.backends).join(", ")}`)
  }

  const type = backendTypes[entry.type]
  if (!type) throw new Error(`Unknown backend type "${entry.type}" for "${name}"`)

  // Version-pinned resolution
  if (opts?.version && opts.version !== entry.version) {
    return resolveVersioned(name, entry, type, opts.version, opts)
  }

  // Check if package is importable
  try {
    import.meta.resolve(entry.package)
  } catch {
    throw new Error(`Backend "${name}" is not installed.\n` + `Run: bunx termless backend install ${name}`)
  }

  // Check if built
  const pkgDir = findPackageDir(entry.package)
  if (pkgDir && !type.isReady(pkgDir)) {
    throw new Error(`Backend "${name}" is installed but not built.\n` + `Run: cd ${pkgDir} && ${getBuildHint(entry)}`)
  }

  return type.resolve(entry.package, opts)
}

/** Check if a backend is installed and ready. */
export function isReady(name: string): boolean {
  const m = manifest()
  const entry = m.backends[name]
  if (!entry) return false

  try {
    import.meta.resolve(entry.package)
  } catch {
    return false
  }

  const type = backendTypes[entry.type]
  if (!type) return false

  const pkgDir = findPackageDir(entry.package)
  return pkgDir ? type.isReady(pkgDir) : false
}

/** List all backend names. */
export function backends(): string[] {
  return Object.keys(manifest().backends)
}

/** Get entry for a backend. */
export function entry(name: string): BackendEntry | undefined {
  return manifest().backends[name]
}

/** Create a Terminal by backend name. */
export async function createTerminalByName(
  name: string,
  opts?: { cols?: number; rows?: number; scrollbackLimit?: number; version?: string },
): Promise<Terminal> {
  const b = await backend(name, opts)
  return createTerminal({ backend: b, ...opts })
}

// ═══════════════════════════════════════════════════════
// Version-pinned resolution
// ═══════════════════════════════════════════════════════

const CACHE_DIR = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "termless", "backends")

async function resolveVersioned(
  name: string,
  entry: BackendEntry,
  type: BackendType,
  version: string,
  opts?: Partial<TerminalOptions>,
): Promise<TerminalBackend> {
  if (entry.type === "native") {
    throw new Error(
      `Version-pinned resolution for native backend "${name}" requires nix.\n` +
        `Run: nix develop .#${name}-${version.replace(/\./g, "_")}`,
    )
  }

  if (!entry.upstream) {
    throw new Error(`Backend "${name}" has no upstream to version-pin.`)
  }

  const cacheDir = ensureCachedVersion(entry.upstream, version)

  const origNodePath = process.env.NODE_PATH
  process.env.NODE_PATH = join(cacheDir, "node_modules") + (origNodePath ? `:${origNodePath}` : "")

  try {
    return await type.resolve(entry.package, opts)
  } finally {
    if (origNodePath) process.env.NODE_PATH = origNodePath
    else delete process.env.NODE_PATH
  }
}

// ═══════════════════════════════════════════════════════
// Version cache (shared by backend() and census)
// ═══════════════════════════════════════════════════════

/**
 * Install an upstream package at a specific version to the cache directory.
 * Returns the cache dir path (contains node_modules/).
 * Shared by backend() version-pinned resolution and census versioned runs.
 */
export function ensureCachedVersion(upstream: string, version: string): string {
  const cacheDir = join(CACHE_DIR, `${upstream.replace(/[/@]/g, "_")}-${version}`)

  if (!existsSync(join(cacheDir, "node_modules"))) {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(
      join(cacheDir, "package.json"),
      JSON.stringify({ private: true, dependencies: { [upstream]: version } }),
    )
    execSync("bun install --no-save", { cwd: cacheDir, stdio: "pipe" })
  }

  return cacheDir
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

function findPackageDir(packageName: string): string | null {
  try {
    const resolved = fileURLToPath(import.meta.resolve(packageName))
    let dir = dirname(resolved)
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, "package.json"))) {
        try {
          const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as any
          if (pkg.name === packageName) return dir
        } catch {}
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {}
  return null
}

function getBuildHint(entry: BackendEntry): string {
  if (entry.type === "native") return "cargo build --release"
  if (entry.type === "wasm") return "bash build/build.sh"
  return "bun install"
}

/** Get installed version of a backend package. */
export function getInstalledVersion(packageName: string): string | null {
  const dir = findPackageDir(packageName)
  if (!dir) return null
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as Record<string, any>
    return pkg.version ?? null
  } catch {
    return null
  }
}

/** Detect package manager from lockfiles. */
export function detectPackageManager(): "bun" | "npm" | "pnpm" | "yarn" {
  const cwd = process.cwd()
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun"
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn"
  return "npm"
}

export type ResolveOptions = Partial<TerminalOptions> & { version?: string }
