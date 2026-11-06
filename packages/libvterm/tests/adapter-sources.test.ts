/**
 * @failure Libvterm source identity omits or binds stale adapter and WASM-loader bytes.
 * @level l0
 * @consumer Headless collector runtime source identity.
 * @testonly none
 */
import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { hasExtension, type AdapterSourcesExtension } from "../../../src/terminal/types.ts"
import { createLibvtermBackend } from "../src/backend.ts"

// Declaration integrity is independent of WASM availability; no init/feed is performed.
// The engine tests skip without a built WASM, so they cannot catch a missing or stale source binding.
test("exposes actual adapter source bytes without initializing the engine", () => {
  const backend = createLibvtermBackend()
  expect(hasExtension(backend, "adapter-sources")).toBe(true)
  if (!hasExtension<AdapterSourcesExtension>(backend, "adapter-sources")) {
    throw new Error("libvterm exposes no adapter sources")
  }
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const sources = [
    "../src/index.ts",
    "../src/backend.ts",
    "../src/wasm-bindings.ts",
    "../wasm/libvterm.js",
    "../../../src/terminal/key-mapping.ts",
  ]
  expect(backend.getAdapterSources()).toEqual(
    sources.map((path) => {
      const target = realpathSync(fileURLToPath(new URL(path, import.meta.url)))
      const bytes = readFileSync(target)
      return {
        path: relative(repo, target).replaceAll("\\", "/"),
        blobOid: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      }
    }),
  )
  backend.destroy()
})
