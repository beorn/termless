import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// Native paste delegates to this Screen and returns bytes without entering that path.
// Re-audited bd3d32ae -> 7e6c993c: removing DEC-private 4 leaves byte feed and reply forwarding unchanged.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt220/src/index.ts",
      blobOid: "601dd26eb7e753a5396ebdf72f1ef8ee2cc4355f",
    },
    {
      path: "packages/vt220/src/backend.ts",
      blobOid: "7b8ee3b0898ef1e8fabf14dcb770ad08999e75e9",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "source",
      repository: "git@github.com:beorn/vterm.git",
      treeOid: "dee664e0e0554a5465a0c78cf760f437a360b0f2",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
