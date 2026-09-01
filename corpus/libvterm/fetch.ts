#!/usr/bin/env bun
// Fetches libvterm's `t/*.test` conformance files (see source-files.ts) from
// the upstream repo, PINNED to the provenance commit in README.md — so
// `fetch.ts && extract.ts` reproduces the checked-in corpus byte-identically
// rather than tracking a moving upstream. Pass an explicit ref only when
// deliberately refreshing; a refresh must also update PINNED_REF + the README
// provenance section.
//
// Standalone script: node:fs / node:path / node:url only, no termless imports
// (matches the corpus contract's independence requirement).
//
// Usage:
//   bun fetch.ts [outDir] [ref]  # default outDir: ./src (gitignored scratch)
//   bun extract.ts <outDir>      # then feed that dir to extract.ts

import { writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { SOURCE_FILES } from "./source-files.ts"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
// The upstream commit this corpus was extracted from (README.md § Provenance).
const PINNED_REF = "934bc2fbf21800ac3458a499df8820ca5fb45fd3"

async function main(): Promise<void> {
  const outDir = process.argv[2] ?? join(SCRIPT_DIR, "src")
  const ref = process.argv[3] ?? PINNED_REF
  const upstreamRaw = `https://raw.githubusercontent.com/neovim/libvterm/${ref}/t`
  if (ref !== PINNED_REF) {
    console.warn(
      `NOTE: fetching ref ${ref} (not the pinned provenance commit) — this is a refresh, not a reproduction.`,
    )
  }
  mkdirSync(outDir, { recursive: true })

  let ok = 0
  const failures: string[] = []
  for (const file of SOURCE_FILES) {
    const res = await fetch(`${upstreamRaw}/${file}`)
    if (!res.ok) {
      console.error(`FAILED ${file}: HTTP ${res.status}`)
      failures.push(file)
      continue
    }
    const text = await res.text()
    writeFileSync(join(outDir, file), text, "utf8")
    ok++
    console.log(`fetched ${file} (${text.length.toLocaleString()} bytes)`)
  }

  console.log(`\n${ok}/${SOURCE_FILES.length} files fetched to ${outDir}`)
  if (failures.length > 0) {
    console.error(`Failed: ${failures.join(", ")}`)
    console.error(
      "A 404 usually means the file moved or was renamed upstream — check " +
        `https://github.com/neovim/libvterm/tree/${ref}/t and update source-files.ts. ` +
        "Note the upstream repo was ARCHIVED 2026-06-19; libvterm now lives inside the neovim tree.",
    )
    process.exit(1)
  }
}

void main()
