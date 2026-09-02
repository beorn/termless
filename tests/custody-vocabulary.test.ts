/**
 * Standing check for the unterm A3 acceptance line: "custody" appears in no
 * public vocabulary.
 *
 * The hab session record keeps "custody" as its own internal lifecycle
 * language (who currently owns a live session). This package's recording
 * vocabulary — Recording, Trace, Event, io, Session, checkpoints, and every
 * doc that describes them — never adopts that word; a reintroduction here
 * would be a naming leak across that boundary, not a synonym worth reusing.
 *
 * Scope: this repository's own docs and source, not a sibling package or the
 * hab side, which are free to use the term for their own concept.
 */

import { describe, expect, test } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, extname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Whole word, case-insensitive: matches "custody"/"Custody", not "custodian". */
const CUSTODY_WORD = /\bcustody\b/i

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"])

/** Recursively collect file paths under `dir` for which `include(path)` holds. */
function collectFiles(dir: string, include: (path: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, include))
    } else if (entry.isFile() && include(full)) {
      out.push(full)
    }
  }
  return out
}

const isMarkdown = (path: string): boolean => extname(path) === ".md"
const isTypeScript = (path: string): boolean => extname(path) === ".ts"

/**
 * Every file this repository's public vocabulary lives in: the two root
 * docs, everything under `docs/`, every source file under `src/`, and each
 * package's own source tree plus its README.
 */
function vocabularyFiles(): string[] {
  const files: string[] = []

  for (const name of ["README.md", "CLAUDE.md"]) {
    const full = join(REPO_ROOT, name)
    if (existsSync(full)) files.push(full)
  }

  files.push(...collectFiles(join(REPO_ROOT, "docs"), isMarkdown))
  files.push(...collectFiles(join(REPO_ROOT, "src"), isTypeScript))

  const packagesDir = join(REPO_ROOT, "packages")
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue
    const pkgDir = join(packagesDir, entry.name)

    const pkgSrc = join(pkgDir, "src")
    if (existsSync(pkgSrc)) files.push(...collectFiles(pkgSrc, isTypeScript))

    const pkgReadme = join(pkgDir, "README.md")
    if (existsSync(pkgReadme)) files.push(pkgReadme)
  }

  return files
}

describe("custody vocabulary", () => {
  test("covers a non-trivial surface (a silent empty scan would hide every real hit)", () => {
    const files = vocabularyFiles()
    expect(files).toContain(join(REPO_ROOT, "README.md"))
    expect(files).toContain(join(REPO_ROOT, "CLAUDE.md"))
    expect(files.some((f) => f.startsWith(join(REPO_ROOT, "docs") + sep) && f.endsWith(".md"))).toBe(true)
    expect(files.some((f) => f.startsWith(join(REPO_ROOT, "src") + sep) && f.endsWith(".ts"))).toBe(true)
    expect(files.some((f) => f.startsWith(join(REPO_ROOT, "packages") + sep) && f.endsWith(".ts"))).toBe(true)
    expect(files.length).toBeGreaterThan(20)
  })

  test("no public vocabulary file uses the word custody", () => {
    const hits = vocabularyFiles().filter((file) => CUSTODY_WORD.test(readFileSync(file, "utf8")))
    expect(hits).toEqual([])
  })
})
