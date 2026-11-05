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
      blobOid: "f2a358e3557802777582bf132864b87f970cd1d6",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "source",
      repository: "git@github.com:beorn/vterm.git",
      treeOid: "1c5664b508d6d0dcb65ae14c0a401fb51cbb376a",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
