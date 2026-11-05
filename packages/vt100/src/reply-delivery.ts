import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// Native paste delegates to this Screen and returns bytes without entering that path.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt100/src/index.ts",
      blobOid: "99833d737402f9d1d8e3e257e3a255d8aa1facc3",
    },
    {
      path: "packages/vt100/src/backend.ts",
      blobOid: "7e013db3015f598043f1c29e5575d93d34abab55",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "source",
      repository: "git@github.com:beorn/vterm.git",
      treeOid: "72b03cdc69980e98fe83eb9ecd51a5b01bbc4ccb",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
