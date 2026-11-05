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
      blobOid: "211d24cba1a76240b859ea933f83a1c73f6251a8",
    },
    {
      path: "packages/ghostty/src/load-native.ts",
      blobOid: "56f1eb8218a5d450635d8ab7ff0ec507eddd960c",
    },
    {
      path: "vendor/ghostty-web/dist/ghostty-web.js",
      blobOid: "dc4d7cab5e0629d17d352cf114a4ffee91aed890",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "wasm",
      sha256: "aaf8ce18ad92e98b1233d85b5f71043aceccf3abbc75dea07e1c704cd3ae690a",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
