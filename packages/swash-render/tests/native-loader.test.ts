import { describe, expect, it } from "vitest"
import { _swashNativeLoadCandidatesForTesting } from "../src/index.ts"

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
