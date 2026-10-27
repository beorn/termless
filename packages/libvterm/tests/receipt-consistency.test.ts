/**
 * @failure Vendored libvterm source or declarations run against a stale or missing WASM pair.
 * @acceptance CTO artifact landing T3: the pair, inputs and upstream tag match one receipt.
 * @level l1 — real package artifact and source bytes, without loading the engine.
 * @consumer @termless/libvterm loading the vendored native pair; #30695 artifact landing.
 * @reach fs-walk vendor/termless/packages/libvterm/wasm/** vendor/termless/packages/libvterm/build/**
 * @testonly none
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const packageDir = fileURLToPath(new URL("../", import.meta.url))

test("the committed libvterm pair and build inputs match their receipt", () => {
  const bytes = (path: string) => readFileSync(resolve(packageDir, path))
  const hash = (path: string) => createHash("sha256").update(bytes(path)).digest("hex")
  const receipt = JSON.parse(bytes("wasm/libvterm.wasm.receipt.json").toString()) as {
    sha256: string
    jsSha256: string
    upstreamTag: string
    buildInputs: Record<string, string>
  }

  expect(receipt.sha256, "wasm/libvterm.wasm").toBe(hash("wasm/libvterm.wasm"))
  expect(receipt.jsSha256, "wasm/libvterm.js").toBe(hash("wasm/libvterm.js"))
  for (const [field, path] of Object.entries({
    flatApiSha256: "build/flat-api.c",
    buildScriptSha256: "build/build.sh",
    dtsSha256: "wasm/libvterm.d.ts",
  })) {
    expect(receipt.buildInputs[field], path).toBe(hash(path))
  }
  const tag = /^LIBVTERM_TAG="([^"]+)"/m.exec(bytes("build/build.sh").toString())?.[1]
  expect(tag, "build/build.sh LIBVTERM_TAG declaration").toBeDefined()
  expect(receipt.upstreamTag, "upstreamTag versus build/build.sh LIBVTERM_TAG").toBe(tag)
})
