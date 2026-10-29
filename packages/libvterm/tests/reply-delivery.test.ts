/**
 * @failure Audited libvterm reply delivery is omitted, or binds adapter/loader bytes or a WASM other than the audited ones.
 * @level l0
 * @consumer Headless collector WASM reply eligibility (DA1 sentinel negatives for libvterm).
 * @testonly none
 */
import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { hasExtension, type ReplyDeliveryExtension } from "../../../src/terminal/types.ts"
import { createLibvtermBackend } from "../src/backend.ts"

// Declaration integrity is independent of WASM availability; no init/feed is performed.
// The engine tests skip without a built WASM, so they cannot catch a missing or stale source binding.
test("declares audited WASM reply delivery without initializing the engine", () => {
  const backend = createLibvtermBackend()
  expect(hasExtension(backend, "reply-delivery")).toBe(true)
  if (!hasExtension<ReplyDeliveryExtension>(backend, "reply-delivery")) {
    throw new Error("libvterm declares no reply delivery")
  }
  const receipt = JSON.parse(
    readFileSync(fileURLToPath(new URL("../wasm/libvterm.wasm.receipt.json", import.meta.url)), "utf8"),
  ) as { sha256: string }
  expect(backend.replyDelivery.engine).toEqual({ kind: "wasm", sha256: receipt.sha256 })
  expect(backend.replyDelivery.boundary).toBe("feed-and-getCursor")
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const sources = ["../src/index.ts", "../src/backend.ts", "../src/wasm-bindings.ts", "../wasm/libvterm.js"]
  expect(backend.replyDelivery.adapterSources).toEqual(
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
