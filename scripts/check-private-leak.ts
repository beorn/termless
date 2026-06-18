#!/usr/bin/env bun
/**
 * Guard: fail the docs build if internal/private content would be published.
 *
 * This is a PUBLIC documentation site built from docs/ with VitePress, which
 * turns every .md under docs/ into a route. Internal artifacts — AI-generated
 * reviews, design notes, drafts, scratch — must never ship as routes. This
 * script is the gate that makes a `/reviews/` (or similar) page impossible to
 * publish silently. (Pattern first deployed on terminfo.dev after an internal
 * AI review leaked live at /reviews/.)
 *
 * It checks THREE layers:
 *   1. SOURCE  — no internal .md under docs/: forbidden path segments
 *                (reviews/internal/drafts/...), the `llm-meta` marker that AI
 *                review/enrichment output carries, or frontmatter that opts a
 *                page out of publication (private/draft: true, publish: false).
 *   2. BUILD   — no forbidden route directory in docs/.vitepress/dist/ (only
 *                checked when a build exists).
 *   3. SITEMAP — no forbidden path in dist/sitemap.xml.
 *
 * SOURCE is always checked; BUILD/SITEMAP are checked when dist/ exists. In CI
 * this runs right after the docs build, so all three layers are active.
 *
 * Exit code: 1 if any leak is found, 0 otherwise. 2 on usage error.
 *
 * Usage:
 *   bun scripts/check-private-leak.ts            # default docs/ + dist/
 *   bun scripts/check-private-leak.ts <docs-dir> # custom docs dir
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const RESET = "\x1b[0m"

// ---------------------------------------------------------------------------
// Policy — what counts as "must never publish"
// ---------------------------------------------------------------------------

/**
 * Path segments that mark a directory/file as internal. A docs route whose path
 * contains any of these (e.g. `/reviews/...`) is a leak. Keep this in sync with
 * the `srcExclude` list in docs/.vitepress/config.ts.
 */
export const FORBIDDEN_SEGMENTS = ["reviews", "internal", "drafts", "private", "scratch", "wip"] as const

/** Substrings that mark file *content* as internal (AI review/enrichment output). */
export const FORBIDDEN_MARKERS = ["llm-meta"] as const

/** Frontmatter flags (key: value) that opt a page out of publication. */
const FRONTMATTER_OPT_OUT: Array<{ key: string; value: string }> = [
  { key: "private", value: "true" },
  { key: "draft", value: "true" },
  { key: "publish", value: "false" },
]

export interface Violation {
  layer: "source" | "build" | "sitemap"
  path: string
  reason: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walk(dir: string, onFile: (full: string) => void): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".vitepress" || name.startsWith(".git")) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, onFile)
    else onFile(full)
  }
}

function segmentsOf(relPath: string): string[] {
  return relPath.split(sep).filter(Boolean)
}

function firstForbiddenSegment(relPath: string): string | undefined {
  const segs = segmentsOf(relPath).map((s) => s.toLowerCase())
  return FORBIDDEN_SEGMENTS.find((f) => segs.includes(f))
}

/** Read the leading `--- ... ---` YAML frontmatter block (raw lines), if any. */
function frontmatterLines(content: string): string[] {
  if (!content.startsWith("---")) return []
  const end = content.indexOf("\n---", 3)
  if (end === -1) return []
  return content.slice(3, end).split("\n")
}

// ---------------------------------------------------------------------------
// Layer 1 — SOURCE scan (docs/**/*.md)
// ---------------------------------------------------------------------------

export function scanSources(docsDir: string): Violation[] {
  const violations: Violation[] = []
  if (!existsSync(docsDir)) return violations

  walk(docsDir, (full) => {
    if (!full.endsWith(".md")) return
    const rel = relative(docsDir, full)

    const seg = firstForbiddenSegment(rel)
    if (seg) {
      violations.push({
        layer: "source",
        path: `docs/${rel}`,
        reason: `internal path segment "${seg}/" — would publish as a route`,
      })
      return // one finding per file is enough
    }

    const content = readFileSync(full, "utf-8")

    const marker = FORBIDDEN_MARKERS.find((m) => content.includes(m))
    if (marker) {
      violations.push({
        layer: "source",
        path: `docs/${rel}`,
        reason: `contains internal marker "${marker}" (AI review/enrichment output)`,
      })
      return
    }

    const fm = frontmatterLines(content)
    for (const { key, value } of FRONTMATTER_OPT_OUT) {
      const re = new RegExp(`^\\s*${key}\\s*:\\s*${value}\\s*$`, "i")
      if (fm.some((l) => re.test(l))) {
        violations.push({
          layer: "source",
          path: `docs/${rel}`,
          reason: `frontmatter "${key}: ${value}" but file is under docs/ (would publish anyway)`,
        })
        return
      }
    }
  })

  return violations
}

// ---------------------------------------------------------------------------
// Layer 2 — BUILD scan (dist/**)
// ---------------------------------------------------------------------------

export function scanDist(distDir: string): Violation[] {
  const violations: Violation[] = []
  if (!existsSync(distDir)) return violations

  walk(distDir, (full) => {
    const rel = relative(distDir, full)
    const seg = firstForbiddenSegment(rel)
    if (seg && full.endsWith(".html")) {
      violations.push({
        layer: "build",
        path: `dist/${rel}`,
        reason: `built page under "${seg}/" — internal content reached the published site`,
      })
    }
  })

  return violations
}

// ---------------------------------------------------------------------------
// Layer 3 — SITEMAP scan (dist/sitemap.xml)
// ---------------------------------------------------------------------------

export function scanSitemap(distDir: string): Violation[] {
  const violations: Violation[] = []
  const sitemap = join(distDir, "sitemap.xml")
  if (!existsSync(sitemap)) return violations

  const xml = readFileSync(sitemap, "utf-8")
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? "")
  for (const loc of locs) {
    let path: string
    try {
      path = new URL(loc).pathname
    } catch {
      path = loc
    }
    const seg = segmentsOf(path)
      .map((s) => s.toLowerCase())
      .find((s) => (FORBIDDEN_SEGMENTS as readonly string[]).includes(s))
    if (seg) {
      violations.push({
        layer: "sitemap",
        path: loc,
        reason: `sitemap advertises an internal "${seg}/" route`,
      })
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export function checkPrivateLeak(docsDir: string): Violation[] {
  const distDir = join(docsDir, ".vitepress", "dist")
  return [...scanSources(docsDir), ...scanDist(distDir), ...scanSitemap(distDir)]
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const defaultDocs = resolve(__dirname, "..", "docs")
  const docsDir = resolve(process.argv[2] ?? defaultDocs)

  if (!existsSync(docsDir)) {
    console.error(`${RED}ERROR${RESET} docs directory not found: ${docsDir}`)
    process.exit(2)
  }

  const distDir = join(docsDir, ".vitepress", "dist")
  const builtNote = existsSync(distDir)
    ? `${DIM}(scanning source + built dist + sitemap)${RESET}`
    : `${YELLOW}(no dist/ — source-only scan; run the docs build for full coverage)${RESET}`

  console.error(`${BOLD}check-private-leak${RESET} ${builtNote}`)

  const violations = checkPrivateLeak(docsDir)

  if (violations.length === 0) {
    console.error(`${GREEN}✓${RESET} no internal/private content would be published`)
    process.exit(0)
  }

  console.error(`\n${RED}${BOLD}PRIVATE-CONTENT LEAK — ${violations.length} finding(s)${RESET}\n`)
  for (const v of violations) {
    console.error(`  ${RED}✗${RESET} [${v.layer}] ${BOLD}${v.path}${RESET}`)
    console.error(`      ${v.reason}`)
  }
  console.error(
    `\n${YELLOW}Internal artifacts must not live under docs/.${RESET} Move them out of the` +
      ` published tree (e.g. a private location outside this repo) — they must never become routes.\n`,
  )
  process.exit(1)
}

if (import.meta.main) main()
