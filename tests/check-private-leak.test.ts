import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { checkPrivateLeak, scanDist, scanSitemap, scanSources } from "../scripts/check-private-leak.ts"

let docs: string

function write(rel: string, content: string): void {
  const full = join(docs, rel)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content)
}

beforeEach(() => {
  docs = mkdtempSync(join(tmpdir(), "leak-"))
})

afterEach(() => {
  rmSync(docs, { recursive: true, force: true })
})

describe("check-private-leak — source scan", () => {
  it("passes on a clean docs tree", () => {
    write("index.md", "# Home\n")
    write("guide/start.md", "# Start\n")
    expect(scanSources(docs)).toEqual([])
  })

  it("flags a file under reviews/ (the leak shape)", () => {
    write("reviews/gpt-pro-2026.md", "# review\n")
    const v = scanSources(docs)
    expect(v).toHaveLength(1)
    expect(v[0]?.reason).toContain("reviews/")
  })

  it("flags internal/ drafts/ private/ segments", () => {
    write("internal/notes.md", "# notes\n")
    write("drafts/idea.md", "# idea\n")
    write("guide/private/secret.md", "# nested\n")
    expect(scanSources(docs)).toHaveLength(3)
  })

  it("flags the llm-meta marker and opt-out frontmatter", () => {
    write("a.md", '<!-- llm-meta: {"model":"x"} -->\n# A\n')
    write("b.md", "---\nprivate: true\n---\n# B\n")
    write("c.md", "---\npublish: false\n---\n# C\n")
    expect(scanSources(docs)).toHaveLength(3)
  })

  it("does not flag ordinary frontmatter", () => {
    write("a.md", "---\ntitle: Hi\ndraft: false\n---\n# A\n")
    expect(scanSources(docs)).toEqual([])
  })
})

describe("check-private-leak — build + sitemap scan", () => {
  it("flags a forbidden built route and sitemap entry", () => {
    write("reviews/x.md", "# x\n")
    const dist = join(docs, ".vitepress", "dist")
    mkdirSync(join(dist, "reviews"), { recursive: true })
    writeFileSync(join(dist, "reviews", "index.html"), "<html></html>")
    writeFileSync(
      join(dist, "sitemap.xml"),
      `<?xml version="1.0"?><urlset><url><loc>https://example.dev/reviews/x</loc></url></urlset>`,
    )
    expect(scanDist(dist)).toHaveLength(1)
    expect(scanSitemap(dist)).toHaveLength(1)
    const layers = new Set(checkPrivateLeak(docs).map((v) => v.layer))
    expect(layers).toEqual(new Set(["source", "build", "sitemap"]))
  })
})
