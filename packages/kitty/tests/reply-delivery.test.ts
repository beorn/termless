/**
 * @failure Audited kitty batch-replay reply delivery is omitted, or binds adapter/bridge bytes or a kitty executable other than the audited ones.
 * @level l0
 * @consumer Headless collector native reply eligibility (DA1 sentinel negatives for kitty).
 * @testonly none
 */
import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { hasExtension, type ReplyDeliveryExtension } from "../../../src/terminal/types.ts"
import { createKittyBackend } from "../src/backend.ts"

// Declaration integrity is independent of kitty availability; no init/feed is performed.
// The audit behind these bytes: census-0.49.2.md enumerates every kitty 0.49.2 Screen -> Window callback and whether the
// real Window replies (the bridge answers DA1 and colour reports; the rest drain as UNREPRODUCED_CALLBACK), and
// trace2.out measured each scoped query against kitty 0.49.2's unmodified Window methods. An edit to the bridge or the
// backend changes a blob id below and needs that audit again.
test("declares audited batch-replay reply delivery without starting kitty", () => {
  const backend = createKittyBackend()
  expect(hasExtension(backend, "reply-delivery")).toBe(true)
  if (!hasExtension<ReplyDeliveryExtension>(backend, "reply-delivery")) {
    throw new Error("kitty declares no reply delivery")
  }
  expect(backend.replyDelivery.engine).toEqual({
    kind: "native",
    sha256: "c490c7d98fbf5a9acbcff14b8153cb5beae2f3df47ae30211119116a25ac9bbc",
  })
  expect(backend.replyDelivery.boundary).toBe("feed-and-getCursor")
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const sources = ["../src/index.ts", "../src/backend.ts", "../build/bridge.py"]
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
