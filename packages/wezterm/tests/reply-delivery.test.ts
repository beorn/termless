/**
 * @failure Audited WezTerm native reply delivery is omitted, or binds adapter/loader bytes or a native artifact other than the audited ones.
 * @level l0
 * @consumer Headless collector native reply eligibility (DA1 sentinel negatives for WezTerm).
 * @testonly none
 */
import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { hasExtension, type ReplyDeliveryExtension } from "../../../src/terminal/types.ts"
import { createWeztermBackend } from "../src/backend.ts"

// Declaration integrity is independent of addon availability; no init/feed is performed.
// The native behaviour tests skip without a built addon, so they cannot catch a missing or stale source binding.
test("declares audited native reply delivery without initializing the engine", () => {
  const backend = createWeztermBackend()
  expect(hasExtension(backend, "reply-delivery")).toBe(true)
  if (!hasExtension<ReplyDeliveryExtension>(backend, "reply-delivery")) {
    throw new Error("WezTerm declares no reply delivery")
  }
  expect(backend.replyDelivery.engine).toEqual({
    kind: "native",
    sha256: "84da518e3f298a0ed75f186db6e39d87e99b8f0c8508dd7252ec0cafee77fe12",
  })
  expect(backend.replyDelivery.boundary).toBe("feed-and-getCursor")
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const sources = ["../src/index.ts", "../src/backend.ts", "../native/src/lib.rs", "../../../src/load-native.ts"]
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
