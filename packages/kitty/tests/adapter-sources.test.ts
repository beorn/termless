/**
 * @failure Kitty source identity omits or binds stale adapter and bridge bytes.
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
import { createKittyBackend } from "../src/backend.ts"

// Source identity is independent of Kitty availability; no init/feed is performed.
test("exposes actual adapter source bytes without initializing the engine", () => {
  const backend = createKittyBackend()
  expect(hasExtension(backend, "adapter-sources")).toBe(true)
  if (!hasExtension<AdapterSourcesExtension>(backend, "adapter-sources")) {
    throw new Error("kitty exposes no adapter sources")
  }
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const sources = [
    "../src/index.ts",
    "../src/backend.ts",
    "../build/bridge.py",
    "../build/layout.c",
    "../build/native-mode-layout.json",
    "../build/native-mode-layout.receipt.json",
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
