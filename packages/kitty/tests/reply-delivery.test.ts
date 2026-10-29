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
    sha256: "bb65c2d57e56eecca8143d73771432cf7dd386bccd36ae658950e5923a661886",
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

// The launcher's bytes follow the flake lock (autoPatchelf rewrites the ELF), so the declared engine must be the launcher
// this host loads: a lock bump that changes it fails here, not by turning every kitty decision into a non-member.
const binary = process.env.KITTY_BINARY
test.skipIf(!binary)("declares the kitty launcher KITTY_BINARY loads", () => {
  const backend = createKittyBackend()
  if (!hasExtension<ReplyDeliveryExtension>(backend, "reply-delivery")) {
    throw new Error("kitty declares no reply delivery")
  }
  const loaded = createHash("sha256")
    .update(readFileSync(realpathSync(binary!)))
    .digest("hex")
  expect(loaded).toBe(backend.replyDelivery.engine.sha256)
  backend.destroy()
})
