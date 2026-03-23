/**
 * `termless update` — check upstream registries for newer backend versions.
 *
 * Compares versions in backends.json against npm, crates.io, and GitHub,
 * then prints a summary table. Use `--apply` to write updates to backends.json.
 */

import type { Command } from "commander"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { manifest, backends, entry } from "../../../src/backends.ts"

// ── Upstream version checkers ──

async function checkNpmVersion(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`)
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

async function checkCrateVersion(crate: string): Promise<string | null> {
  try {
    const res = await fetch(`https://crates.io/api/v1/crates/${crate}`, {
      headers: { "User-Agent": "termless-cli (https://github.com/beorn/termless)" },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { crate?: { max_version?: string } }
    return data.crate?.max_version ?? null
  } catch {
    return null
  }
}

async function checkGithubVersion(repo: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`)
    if (!res.ok) {
      // Try tags if no releases
      const tagRes = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`)
      if (!tagRes.ok) return null
      const tags = (await tagRes.json()) as Array<{ name?: string }>
      return tags[0]?.name?.replace(/^v/, "") ?? null
    }
    const data = (await res.json()) as { tag_name?: string }
    return data.tag_name?.replace(/^v/, "") ?? null
  } catch {
    return null
  }
}

function parseUpstream(uri: string): { type: "npm" | "crate" | "github"; name: string } {
  if (uri.startsWith("npm:")) return { type: "npm", name: uri.slice(4) }
  if (uri.startsWith("crate:")) return { type: "crate", name: uri.slice(6) }
  if (uri.startsWith("github:")) return { type: "github", name: uri.slice(7) }
  throw new Error(`Unknown upstream URI: ${uri}`)
}

async function checkLatestVersion(uri: string): Promise<string | null> {
  const { type, name } = parseUpstream(uri)
  switch (type) {
    case "npm":
      return checkNpmVersion(name)
    case "crate":
      return checkCrateVersion(name)
    case "github":
      return checkGithubVersion(name)
  }
}

// ── Command ──

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Check upstream registries for newer backend versions")
    .option("--apply", "Update backends.json with latest versions")
    .action(async (opts: { apply?: boolean }) => {
      const m = manifest()
      const allNames = backends()

      console.log(`\ntermless update\n`)
      console.log("  Checking upstream versions...\n")

      // Fetch all versions in parallel
      type Row = {
        name: string
        upstream: string
        current: string
        latest: string | null
        status: string
      }

      const rows: Row[] = await Promise.all(
        allNames.map(async (name) => {
          const e = entry(name)!
          const upstream = e.upstream ?? ""
          const current = e.version ?? ""

          if (!upstream) {
            return { name, upstream: "", current, latest: null, status: "no upstream" }
          }

          const latest = await checkLatestVersion(upstream)

          let status: string
          if (latest === null) {
            status = "? fetch failed"
          } else if (latest === current) {
            status = "✓ up to date"
          } else {
            status = "⬆ update available"
          }

          return { name, upstream, current, latest, status }
        }),
      )

      // Compute column widths
      const col1 = Math.max("Backend".length, ...rows.map((r) => r.name.length))
      const col2 = Math.max("Current".length, ...rows.map((r) => r.current.length))
      const col3 = Math.max("Latest".length, ...rows.map((r) => (r.latest ?? "?").length))

      // Header
      console.log(`  ${"Backend".padEnd(col1)}  ${"Current".padEnd(col2)}  ${"Latest".padEnd(col3)}  Status`)
      console.log(`  ${"─".repeat(col1)}  ${"─".repeat(col2)}  ${"─".repeat(col3)}  ${"─".repeat(20)}`)

      // Rows
      for (const r of rows) {
        console.log(
          `  ${r.name.padEnd(col1)}  ${r.current.padEnd(col2)}  ${(r.latest ?? "?").padEnd(col3)}  ${r.status}`,
        )
      }

      // Count updates
      const updatable = rows.filter((r) => r.latest !== null && r.latest !== r.current)

      if (updatable.length === 0) {
        console.log("\n  All backends up to date.\n")
      } else {
        console.log(`\n  ${updatable.length} update${updatable.length === 1 ? "" : "s"} available.`)

        if (opts.apply) {
          // Read the raw backends.json, update versions, write back
          const __dirname = dirname(fileURLToPath(import.meta.url))
          const manifestPath = join(__dirname, "..", "..", "..", "backends.json")
          const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as any

          for (const r of updatable) {
            if (raw.backends[r.name]) {
              raw.backends[r.name].upstreamVersion = r.latest
            }
          }

          writeFileSync(manifestPath, JSON.stringify(raw, null, 2) + "\n", "utf-8")
          console.log("  Updated backends.json.\n")
        } else {
          console.log("  Run with --apply to update backends.json.\n")
        }
      }
    })
}
