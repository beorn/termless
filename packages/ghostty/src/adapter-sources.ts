import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Synchronous feed writes, updates, then drains the entire growable response buffer into onResponse.
// The wrapper retains unread tails across 256-byte reads; native stream/producer errors trap,
// failed reads throw, and write scratch is freed in finally. Tests exercise real allocation failure
// and DA1/DA2 behind a 900-byte backlog. The WASM is reproduced by vendor/ghostty-web/rebuild.ts.
// This declaration excludes itself; determining source or artifact edits require re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/ghostty/src/index.ts",
      blobOid: "f4b9d9f3e13cc515b23abc739cab21bf971e8585",
    },
    {
      path: "packages/ghostty/src/backend.ts",
      blobOid: "f1917e15e64b8b68bcf495557e1a61810a0a5ff3",
    },
    {
      path: "packages/ghostty/src/load-native.ts",
      blobOid: "56f1eb8218a5d450635d8ab7ff0ec507eddd960c",
    },
    {
      path: "vendor/ghostty-web/dist/ghostty-web.js",
      blobOid: "b174d2496d6777a4b19815b40cfc89c84819de36",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "wasm",
      sha256: "65ab32ca8b3f2f310d288e4640ff5e3a297fc830fe3766a0409fda8ebefa5e4a",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
