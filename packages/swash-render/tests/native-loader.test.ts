/**
 * @failure Native binding failures hide attempted paths and original errors, or stop before a working fallback.
 * @level unit
 * @consumer Five native backend/render loaders use caller-relative synchronous resolution.
 * @testonly none
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { loadNativeAddon } from "../../../src/load-native.ts"
import { _swashNativeLoadCandidatesForTesting } from "../src/index.ts"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "termless-native-loader-"))
  temporaryDirectories.push(directory)
  return { directory, callerUrl: pathToFileURL(join(directory, "caller.mjs")).href }
}

describe("shared native binding loading", () => {
  it("retains missing-module and binding initialization errors with platform and scope", () => {
    const { directory, callerUrl } = fixture()
    writeFileSync(join(directory, "broken.cjs"), 'throw new Error("binding ABI incompatible");')
    let failure: unknown
    try {
      loadNativeAddon({
        callerUrl,
        packageName: "@termless/swash-render",
        candidates: ["./absent.node", "./broken.cjs"],
        prebuiltScope: "separate platform artifacts",
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).toContain(process.platform)
    expect(message).toContain(process.arch)
    expect(message).toContain("separate platform artifacts")
    expect(message).toContain("Cannot find module './absent.node'")
    expect(message).toContain("binding ABI incompatible")
    expect(message.indexOf("./absent.node")).toBeLessThan(message.indexOf("./broken.cjs"))
  })

  it("resolves from the caller and continues to a working fallback after an initialization error", () => {
    const { directory, callerUrl } = fixture()
    writeFileSync(join(directory, "broken.cjs"), 'throw new Error("binding ABI incompatible");')
    writeFileSync(join(directory, "working.cjs"), 'module.exports = { render: () => "caller binding" };')
    const binding = loadNativeAddon<{ render(): string }>({
      callerUrl,
      packageName: "@termless/swash-render",
      candidates: ["./broken.cjs", "./working.cjs"],
      prebuiltScope: "separate platform artifacts",
    })
    expect(binding.render()).toBe("caller binding")
  })
})

describe("swash native loader", () => {
  it("tries the legacy local binary before platform prebuilds", () => {
    expect(_swashNativeLoadCandidatesForTesting("darwin", "arm64")).toEqual([
      "../termless-swash-render.node",
      "../termless-swash-render.darwin-arm64.node",
      "@termless/swash-render-darwin-arm64",
    ])
  })

  it("maps the supported napi-rs platform suffixes", () => {
    expect(_swashNativeLoadCandidatesForTesting("darwin", "x64")).toContain("../termless-swash-render.darwin-x64.node")
    expect(_swashNativeLoadCandidatesForTesting("linux", "x64")).toContain(
      "../termless-swash-render.linux-x64-gnu.node",
    )
    expect(_swashNativeLoadCandidatesForTesting("linux", "arm64", true)).toContain(
      "../termless-swash-render.linux-arm64-musl.node",
    )
    expect(_swashNativeLoadCandidatesForTesting("win32", "x64")).toContain(
      "../termless-swash-render.win32-x64-msvc.node",
    )
  })
})
